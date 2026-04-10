#!/usr/bin/env python3
"""
cc_hunter.py — BCD325P2 P25 control channel hunter and monitor
Component 1 of BearSentinel RF telemetry stack.

Sweeps configured frequency ranges, qualifies candidates by P25 duty cycle
and NAC consistency, locks onto the best control channel, and monitors it
for RF health and TGID traffic (best-effort — TGID decode in QSH mode is
firmware-dependent; CC identification and NAC are reliable).

Standalone usage:
    python cc_hunter.py --port /dev/ttyUSB0 [options]

Component usage:
    from cc_hunter import ControlChannelHunter, HunterConfig, ScannerTransport

    hunter = ControlChannelHunter(
        transport=ScannerTransport("/dev/ttyUSB0"),
        config=HunterConfig(
            sweep_ranges=[FrequencyRange(85100000, 86900000, 1250, "800 MHz")],
        ),
        on_state_change=my_state_handler,
        on_tgid_seen=my_tgid_handler,
        on_cc_lost=my_loss_handler,
    )
    hunter.start()   # non-blocking, runs on daemon thread
    ...
    hunter.stop()

State machine:
    IDLE → SWEEPING → QUALIFYING → LOCKED → SWEEPING (on loss or timeout)

Database schema (SQLite):
    control_channel_locks(id, frequency, nac, locked_at, lost_at)
    tgid_events(id, cc_lock_id, timestamp, tgid, site_type, system_name, ...)
    cc_rssi_samples(id, cc_lock_id, timestamp, rssi)

Integration note for BearSentinel:
    Subscribe on_state_change for LOCKED transitions to get (frequency, nac)
    for SDR handoff. Subscribe on_tgid_seen for real-time TGID stream.
    The hunter's SQLite DB is the authoritative record; callbacks are for
    live consumers only.
"""

import argparse
import logging
import signal
import sqlite3
import sys
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable, Optional

import serial


log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class FrequencyRange:
    """
    Frequency range in BCD325P2 8-digit format (GHz digit → 100 Hz digit).
    851.0125 MHz → 08510125. Step is in the same units.
    """
    low:   int
    high:  int
    step:  int
    label: str = ""


@dataclass
class HunterConfig:
    sweep_ranges: list[FrequencyRange] = field(default_factory=lambda: [
        # Common P25 public safety allocations — adjust for your market.
        # Florida 800 MHz interop band is a good starting point.
        FrequencyRange(85100000, 86900000, 1250, "800 MHz SMR"),
        FrequencyRange(76400000, 77600000, 1250, "700 MHz"),
        FrequencyRange(80600000, 82400000, 1250, "806-824 MHz"),
    ])

    # Sweep behavior
    rssi_minimum:        int   = 200    # 0–1023; skip below this in sweep pass
    top_n_to_qualify:    int   = 10     # examine only the top N by RSSI

    # Qualification thresholds
    qualify_duration_s:         float = 4.0
    qualify_poll_hz:            float = 10.0
    duty_cycle_threshold:       float = 0.85  # fraction of polls with squelch open
    nac_consistency_threshold:  float = 0.70  # fraction of polls returning valid P25NAC

    # Monitor behavior
    monitor_poll_hz:     float = 8.0
    cc_loss_timeout_s:   float = 8.0   # declare CC lost after this silence duration

    # Storage
    db_path:             str   = "cc_monitor.db"

    # Transport (used by standalone entry point; ignored when transport passed directly)
    serial_port:         str   = "/dev/ttyUSB0"
    serial_baud:         int   = 115200


# ---------------------------------------------------------------------------
# Serial transport
# ---------------------------------------------------------------------------

class ScannerTransport:
    """
    Synchronous, thread-safe request/response wrapper.
    One command in flight at a time; caller blocks until response or timeout.
    """

    def __init__(self, port: str, baud: int = 115200, timeout_s: float = 1.0):
        self._serial = serial.Serial(port, baud, timeout=timeout_s)
        self._lock   = threading.Lock()
        time.sleep(0.5)
        self._serial.reset_input_buffer()
        log.debug("Transport open on %s @ %d", port, baud)

    def command(self, cmd: str) -> str:
        with self._lock:
            self._serial.reset_input_buffer()
            self._serial.write((cmd + "\r").encode("ascii"))
            raw = self._serial.readline()
            response = raw.decode("ascii", errors="replace").strip()
            log.debug(">> %s  << %s", cmd, response)
            return response

    def close(self):
        self._serial.close()


# ---------------------------------------------------------------------------
# Protocol response types
# ---------------------------------------------------------------------------

@dataclass
class GLGResponse:
    """Parsed GLG (Get Reception Status) response."""
    frequency:    Optional[str] = None
    modulation:   Optional[str] = None
    squelch_open: bool          = False
    p25_nac:      Optional[str] = None
    system_name:  str           = ""
    group_name:   str           = ""
    channel_name: str           = ""

    @property
    def has_valid_nac(self) -> bool:
        # NONE means no decode; 1000-100F are DMR color codes, not P25 NACs.
        return bool(
            self.p25_nac
            and self.p25_nac not in ("NONE", "NG", "")
            and not self.p25_nac.upper().startswith("1000")
        )

    @classmethod
    def parse(cls, raw: str) -> Optional["GLGResponse"]:
        # GLG,FRQ,MOD,ATT,CTCSS,NAME1,NAME2,NAME3,SQL,MUT,SYS_TAG,CHAN_TAG,P25NAC
        if not raw.startswith("GLG,"):
            return None
        parts = raw.split(",")
        if len(parts) < 13:
            return None
        return cls(
            frequency    = parts[1]  or None,
            modulation   = parts[2]  or None,
            squelch_open = parts[8] == "1",
            p25_nac      = parts[12] or None,
            system_name  = parts[5],
            group_name   = parts[6],
            channel_name = parts[7],
        )


@dataclass
class QSCResponse:
    """Parsed QSC (Set frequency / get reception status) response."""
    rssi:         int  = 0
    frequency:    str  = ""
    squelch_open: bool = False

    @classmethod
    def parse(cls, raw: str) -> Optional["QSCResponse"]:
        # QSC,RSSI,FRQ,SQL
        if not raw.startswith("QSC,") or "NG" in raw:
            return None
        parts = raw.split(",")
        if len(parts) < 4:
            return None
        try:
            return cls(
                rssi         = int(parts[1]),
                frequency    = parts[2],
                squelch_open = parts[3] == "1",
            )
        except ValueError:
            return None


@dataclass
class GIDResponse:
    """
    Parsed GID (Get Current TalkGroup ID Status) response.
    Only populated when the scanner's LCD is showing a TGID. In QSH mode
    this is firmware-dependent; treat as best-effort.
    """
    site_type:   str  = ""
    tgid:        str  = ""
    search_mode: str  = ""
    system_name: str  = ""
    group_name:  str  = ""
    tgid_name:   str  = ""
    is_empty:    bool = True

    @classmethod
    def parse(cls, raw: str) -> Optional["GIDResponse"]:
        # GID,SITE_TYPE,TGID,ID_SRCH_MODE,NAME1,NAME2,NAME3
        if not raw.startswith("GID,"):
            return None
        parts = raw.split(",")
        if len(parts) < 7:
            return None
        tgid = parts[2]
        return cls(
            site_type   = parts[1],
            tgid        = tgid,
            search_mode = parts[3],
            system_name = parts[4],
            group_name  = parts[5],
            tgid_name   = parts[6],
            is_empty    = (tgid == ""),
        )


# ---------------------------------------------------------------------------
# Candidate — built during qualification phase
# ---------------------------------------------------------------------------

@dataclass
class ControlChannelCandidate:
    frequency:       str
    mean_rssi:       float = 0.0
    duty_cycle:      float = 0.0   # fraction of qualify polls with squelch open
    nac_consistency: float = 0.0   # fraction of qualify polls returning valid P25NAC
    dominant_nac:    str   = ""    # most common NAC observed during qualification
    score:           float = 0.0

    def compute_score(self):
        # NAC consistency is the strongest discriminator — a voice channel won't
        # produce a stable NAC. Duty cycle is next; RSSI is a tiebreaker.
        self.score = (
            self.nac_consistency            * 0.55
            + self.duty_cycle               * 0.30
            + min(self.mean_rssi / 1023.0, 1.0) * 0.15
        )

    @property
    def qualifies_as_control_channel(self) -> bool:
        return (
            self.duty_cycle      >= 0.85
            and self.nac_consistency >= 0.70
        )

    def summary(self) -> str:
        return (
            f"{_fmt_mhz(self.frequency)}  "
            f"duty={self.duty_cycle:.0%}  "
            f"nac_cons={self.nac_consistency:.0%}  "
            f"rssi={self.mean_rssi:.0f}  "
            f"score={self.score:.3f}  "
            f"nac={self.dominant_nac}"
        )


# ---------------------------------------------------------------------------
# State labels
# ---------------------------------------------------------------------------

class State:
    IDLE      = "IDLE"
    SWEEPING  = "SWEEPING"
    LOCKED    = "LOCKED"
    STOPPED   = "STOPPED"


# ---------------------------------------------------------------------------
# Callback type signatures (for documentation; Python doesn't enforce these)
#
# on_state_change(old_state: str, new_state: str, context: dict)
#   SWEEPING context: {"reason": str}
#   LOCKED context:   {"frequency": str, "nac": str,
#                       "candidate": ControlChannelCandidate}
#
# on_tgid_seen(tgid: str, site_type: str, system_name: str,
#              group_name: str, tgid_name: str, timestamp: float)
#
# on_cc_lost(frequency: str, nac: str, locked_duration_s: float)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def _open_database(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS control_channel_locks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            frequency   TEXT    NOT NULL,
            nac         TEXT,
            locked_at   REAL    NOT NULL,
            lost_at     REAL
        );

        CREATE TABLE IF NOT EXISTS tgid_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            cc_lock_id  INTEGER REFERENCES control_channel_locks(id),
            timestamp   REAL    NOT NULL,
            tgid        TEXT    NOT NULL,
            site_type   TEXT,
            system_name TEXT,
            group_name  TEXT,
            tgid_name   TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_tgid ON tgid_events(tgid);
        CREATE INDEX IF NOT EXISTS idx_tgid_time ON tgid_events(timestamp);

        CREATE TABLE IF NOT EXISTS cc_rssi_samples (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            cc_lock_id  INTEGER REFERENCES control_channel_locks(id),
            timestamp   REAL    NOT NULL,
            rssi        INTEGER NOT NULL
        );
    """)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Hunter
# ---------------------------------------------------------------------------

class ControlChannelHunter:
    """
    Drives the BCD325P2 through three phases to find and hold a P25 CC.

    Thread safety: start()/stop() are safe to call from any thread. Callbacks
    fire on the hunter's internal thread — keep them fast or hand off to a queue.
    """

    def __init__(
        self,
        transport:        ScannerTransport,
        config:           HunterConfig,
        on_state_change:  Optional[Callable] = None,
        on_tgid_seen:     Optional[Callable] = None,
        on_cc_lost:       Optional[Callable] = None,
    ):
        self._transport       = transport
        self._config          = config
        self._on_state_change = on_state_change
        self._on_tgid_seen    = on_tgid_seen
        self._on_cc_lost      = on_cc_lost

        self._state           = State.IDLE
        self._stop_event      = threading.Event()
        self._thread: Optional[threading.Thread] = None

        # Hot-path state — populated on LOCKED transition, cleared on loss.
        # Store here rather than reading from DB on every monitor poll.
        self._locked_frequency: Optional[str] = None
        self._locked_nac:       Optional[str] = None
        self._locked_at:        Optional[float] = None
        self._current_lock_id:  Optional[int] = None

        self._db = _open_database(config.db_path)

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Non-blocking. Returns immediately; work happens on daemon thread."""
        if self._thread and self._thread.is_alive():
            log.warning("start() called on already-running hunter")
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            daemon=True,
            name="cc-hunter",
        )
        self._thread.start()

    def stop(self, timeout_s: float = 10.0) -> None:
        """Signal stop and wait for thread to exit cleanly."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=timeout_s)
        self._db.close()

    def join(self) -> None:
        """Block until stop() is called or thread exits naturally."""
        if self._thread:
            self._thread.join()

    @property
    def state(self) -> str:
        return self._state

    @property
    def locked_frequency(self) -> Optional[str]:
        return self._locked_frequency

    @property
    def locked_nac(self) -> Optional[str]:
        return self._locked_nac

    # ------------------------------------------------------------------
    # State machine core
    # ------------------------------------------------------------------

    def _run(self) -> None:
        self._transition(State.SWEEPING, {"reason": "startup"})
        while not self._stop_event.is_set():
            if self._state == State.SWEEPING:
                self._phase_sweep_and_qualify()
            elif self._state == State.LOCKED:
                self._phase_monitor()
        self._transition(State.STOPPED, {})

    def _transition(self, new_state: str, context: dict) -> None:
        old = self._state
        self._state = new_state
        log.info("%-10s → %-10s  %s", old, new_state, context)
        if self._on_state_change:
            try:
                self._on_state_change(old, new_state, context)
            except Exception:
                log.exception("on_state_change callback raised")

    # ------------------------------------------------------------------
    # Phase 1 + 2: Sweep → qualify
    # ------------------------------------------------------------------

    def _phase_sweep_and_qualify(self) -> None:
        """
        Step through configured ranges with QSC; collect one RSSI reading per
        frequency. Sort by RSSI, qualify the top N, lock onto the best CC.
        """
        rssi_map: dict[str, int] = {}

        for band in self._config.sweep_ranges:
            if self._stop_event.is_set():
                return
            log.info("Sweeping %s  %s → %s",
                     band.label,
                     _fmt_mhz_raw(band.low),
                     _fmt_mhz_raw(band.high))
            frq = band.low
            while frq <= band.high and not self._stop_event.is_set():
                frq_str = f"{frq:08d}"
                raw     = self._transport.command(f"QSC,{frq_str}")
                result  = QSCResponse.parse(raw)
                if result and result.rssi >= self._config.rssi_minimum:
                    # QSC gives a single sample — keep highest if we revisit
                    rssi_map[frq_str] = max(rssi_map.get(frq_str, 0), result.rssi)
                frq += band.step

        if not rssi_map:
            log.warning(
                "Sweep found no frequencies above RSSI %d; waiting before retry",
                self._config.rssi_minimum,
            )
            self._stop_event.wait(timeout=5.0)
            return

        sorted_candidates = sorted(rssi_map.items(), key=lambda kv: kv[1], reverse=True)
        log.info(
            "Sweep complete: %d candidates above threshold. "
            "Top: %s @ RSSI %d",
            len(sorted_candidates),
            _fmt_mhz(sorted_candidates[0][0]),
            sorted_candidates[0][1],
        )

        qualified: list[ControlChannelCandidate] = []

        for frq_str, _ in sorted_candidates[: self._config.top_n_to_qualify]:
            if self._stop_event.is_set():
                return
            candidate = self._qualify_candidate(frq_str)
            log.info("  %s", candidate.summary())
            if candidate.qualifies_as_control_channel:
                qualified.append(candidate)

        if not qualified:
            log.info("No candidates qualified as CC. Re-sweeping in 3s.")
            self._stop_event.wait(timeout=3.0)
            return

        best = max(qualified, key=lambda c: c.score)
        log.info("Best CC: %s", best.summary())

        lock_id = self._db_open_lock(best)
        self._current_lock_id  = lock_id
        self._locked_frequency = best.frequency
        self._locked_nac       = best.dominant_nac
        self._locked_at        = time.time()

        self._transition(State.LOCKED, {
            "frequency": best.frequency,
            "nac":       best.dominant_nac,
            "candidate": best,
        })

    def _qualify_candidate(self, frq_str: str) -> ControlChannelCandidate:
        """
        Park on frequency via QSH with P25 NAC search. Poll GLG and PWR for
        qualify_duration_s. A real control channel will have near-100% squelch
        open and a stable, repeating P25NAC.
        """
        candidate = ControlChannelCandidate(frequency=frq_str)

        # CODE_SRCH=2 → P25 NAC/Color Code search. This is what drives NAC
        # consistency: the scanner attempts P25 decode and GLG reflects the result.
        tune = f"QSH,{frq_str},,NFM,0,2,,2,0000000000000000,0,,0,1,200"
        if "NG" in self._transport.command(tune):
            log.debug("QSH rejected for %s", _fmt_mhz(frq_str))
            return candidate

        time.sleep(0.3)  # scanner needs a moment to lock onto signal

        interval = 1.0 / self._config.qualify_poll_hz
        deadline = time.monotonic() + self._config.qualify_duration_s

        total_polls   = 0
        sql_opens     = 0
        nac_hits      = 0
        nac_tally:    dict[str, int] = defaultdict(int)
        rssi_samples: list[int]      = []

        while time.monotonic() < deadline and not self._stop_event.is_set():
            tick = time.monotonic()

            glg = GLGResponse.parse(self._transport.command("GLG"))
            if glg:
                total_polls += 1
                if glg.squelch_open:
                    sql_opens += 1
                if glg.has_valid_nac:
                    nac_hits += 1
                    nac_tally[glg.p25_nac] += 1

            pwr = self._transport.command("PWR")
            if pwr.startswith("PWR,"):
                parts = pwr.split(",")
                if len(parts) >= 2 and parts[1].isdigit():
                    rssi_samples.append(int(parts[1]))

            time.sleep(max(0.0, interval - (time.monotonic() - tick)))

        if total_polls == 0:
            return candidate

        candidate.mean_rssi       = (sum(rssi_samples) / len(rssi_samples)
                                     if rssi_samples else 0.0)
        candidate.duty_cycle      = sql_opens / total_polls
        candidate.nac_consistency = nac_hits  / total_polls
        candidate.dominant_nac    = (max(nac_tally, key=nac_tally.get)
                                     if nac_tally else "")
        candidate.compute_score()
        return candidate

    # ------------------------------------------------------------------
    # Phase 3: Monitor locked CC
    # ------------------------------------------------------------------

    def _phase_monitor(self) -> None:
        """
        Stay parked on the locked CC. Poll GID for TGID events and GLG for
        squelch health. Declare CC lost after cc_loss_timeout_s of silence;
        re-enter sweep on loss.

        RSSI samples written to cc_rssi_samples at monitor rate — useful for
        downstream signal health dashboards.
        """
        frq_str = self._locked_frequency
        nac     = self._locked_nac

        # Re-park in case scanner wandered between phases.
        self._transport.command(
            f"QSH,{frq_str},,NFM,0,2,,2,0000000000000000,0,,0,1,200"
        )
        time.sleep(0.3)

        interval           = 1.0 / self._config.monitor_poll_hz
        last_activity_time = time.monotonic()

        log.info("Monitoring CC at %s  NAC=%s", _fmt_mhz(frq_str), nac)

        while not self._stop_event.is_set():
            tick = time.monotonic()

            # GID → TGID events (best-effort in QSH mode)
            gid = GIDResponse.parse(self._transport.command("GID"))
            if gid and not gid.is_empty:
                last_activity_time = time.monotonic()
                self._record_tgid(gid)

            # GLG → squelch health and incidental NAC confirmation
            glg = GLGResponse.parse(self._transport.command("GLG"))
            if glg:
                if glg.squelch_open:
                    last_activity_time = time.monotonic()
                # Occasional spot-check: if NAC drifts dramatically, we may
                # have jumped to an adjacent carrier. Log it; don't act yet.
                if (glg.has_valid_nac
                        and glg.p25_nac != nac
                        and glg.p25_nac is not None):
                    log.debug(
                        "NAC mismatch on %s: expected %s, saw %s",
                        _fmt_mhz(frq_str), nac, glg.p25_nac,
                    )

            # RSSI sample to DB for trend analysis
            pwr = self._transport.command("PWR")
            if pwr.startswith("PWR,"):
                parts = pwr.split(",")
                if len(parts) >= 2 and parts[1].isdigit():
                    self._db_rssi_sample(int(parts[1]))

            silence = time.monotonic() - last_activity_time
            if silence > self._config.cc_loss_timeout_s:
                locked_duration = time.time() - (self._locked_at or time.time())
                log.warning(
                    "CC silent for %.1fs — declaring loss at %s",
                    silence,
                    _fmt_mhz(frq_str),
                )
                self._db_close_lock()
                if self._on_cc_lost:
                    try:
                        self._on_cc_lost(frq_str, nac, locked_duration)
                    except Exception:
                        log.exception("on_cc_lost callback raised")
                self._locked_frequency = None
                self._locked_nac       = None
                self._locked_at        = None
                self._current_lock_id  = None
                self._transition(State.SWEEPING, {"reason": "control channel lost"})
                return

            time.sleep(max(0.0, interval - (time.monotonic() - tick)))

    # ------------------------------------------------------------------
    # TGID event handling
    # ------------------------------------------------------------------

    def _record_tgid(self, gid: GIDResponse) -> None:
        ts = time.time()
        self._db.execute(
            """INSERT INTO tgid_events
               (cc_lock_id, timestamp, tgid, site_type, system_name, group_name, tgid_name)
               VALUES (?,?,?,?,?,?,?)""",
            (
                self._current_lock_id,
                ts,
                gid.tgid,
                gid.site_type,
                gid.system_name,
                gid.group_name,
                gid.tgid_name,
            ),
        )
        self._db.commit()

        display_label = gid.tgid_name or gid.group_name or gid.system_name or "?"
        log.info("TGID %-8s  [%s]  %s", gid.tgid, gid.site_type, display_label)

        if self._on_tgid_seen:
            try:
                self._on_tgid_seen(
                    gid.tgid,
                    gid.site_type,
                    gid.system_name,
                    gid.group_name,
                    gid.tgid_name,
                    ts,
                )
            except Exception:
                log.exception("on_tgid_seen callback raised")

    # ------------------------------------------------------------------
    # Database helpers
    # ------------------------------------------------------------------

    def _db_open_lock(self, candidate: ControlChannelCandidate) -> int:
        cursor = self._db.execute(
            "INSERT INTO control_channel_locks (frequency, nac, locked_at) VALUES (?,?,?)",
            (candidate.frequency, candidate.dominant_nac, time.time()),
        )
        self._db.commit()
        return cursor.lastrowid

    def _db_close_lock(self) -> None:
        if self._current_lock_id is None:
            return
        self._db.execute(
            "UPDATE control_channel_locks SET lost_at=? WHERE id=?",
            (time.time(), self._current_lock_id),
        )
        self._db.commit()

    def _db_rssi_sample(self, rssi: int) -> None:
        if self._current_lock_id is None:
            return
        self._db.execute(
            "INSERT INTO cc_rssi_samples (cc_lock_id, timestamp, rssi) VALUES (?,?,?)",
            (self._current_lock_id, time.time(), rssi),
        )
        # Commit in batches would be more efficient; for now correctness > perf.
        self._db.commit()


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _fmt_mhz(frq_8digit_str: str) -> str:
    """Scanner 8-digit frequency string to human-readable MHz."""
    try:
        return f"{int(frq_8digit_str) / 10000:.4f} MHz"
    except (ValueError, TypeError):
        return frq_8digit_str


def _fmt_mhz_raw(frq_8digit_int: int) -> str:
    return f"{frq_8digit_int / 10000:.4f} MHz"


# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="cc_hunter",
        description="BCD325P2 P25 control channel hunter (BearSentinel component 1)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--port",  default="/dev/ttyUSB0", help="Serial port")
    p.add_argument("--baud",  type=int, default=115200)
    p.add_argument("--db",    default="cc_monitor.db", help="SQLite output path")
    p.add_argument(
        "--rssi-min", type=int, default=200, metavar="N",
        help="Minimum RSSI (0–1023) to include a frequency in qualification",
    )
    p.add_argument(
        "--duty-threshold", type=float, default=0.85, metavar="F",
        help="Minimum squelch-open fraction to qualify as CC (0.0–1.0)",
    )
    p.add_argument(
        "--nac-threshold", type=float, default=0.70, metavar="F",
        help="Minimum P25NAC-present fraction to qualify as CC (0.0–1.0)",
    )
    p.add_argument(
        "--qualify-duration", type=float, default=4.0, metavar="S",
        help="Seconds to observe each candidate during qualification",
    )
    p.add_argument(
        "--loss-timeout", type=float, default=8.0, metavar="S",
        help="Seconds of silence before declaring CC lost",
    )
    p.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    return p


def _make_console_callbacks() -> tuple[Callable, Callable, Callable]:
    """Minimal console output for standalone operation."""
    bar = "=" * 62

    def on_state_change(old_state: str, new_state: str, context: dict) -> None:
        if new_state == State.LOCKED:
            print(f"\n{bar}")
            print(f"  LOCKED   {_fmt_mhz(context['frequency'])}")
            print(f"  NAC      {context['nac']}")
            print(f"  Score    {context['candidate'].score:.3f}")
            print(f"{bar}\n")
        elif new_state == State.SWEEPING and old_state == State.LOCKED:
            reason = context.get("reason", "?")
            print(f"\n  Re-sweeping ({reason})\n")

    def on_tgid_seen(
        tgid:        str,
        site_type:   str,
        system_name: str,
        group_name:  str,
        tgid_name:   str,
        timestamp:   float,
    ) -> None:
        label = tgid_name or group_name or system_name or "?"
        print(f"  TGID {tgid:>8}  [{site_type}]  {label}")

    def on_cc_lost(
        frequency:         str,
        nac:               str,
        locked_duration_s: float,
    ) -> None:
        print(
            f"\n  CC LOST  {_fmt_mhz(frequency)}  "
            f"NAC={nac}  held={locked_duration_s:.0f}s\n"
        )

    return on_state_change, on_tgid_seen, on_cc_lost


def main() -> None:
    args = _build_parser().parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
        datefmt="%H:%M:%S",
    )

    config = HunterConfig(
        db_path                   = args.db,
        serial_port               = args.port,
        serial_baud               = args.baud,
        rssi_minimum              = args.rssi_min,
        duty_cycle_threshold      = args.duty_threshold,
        nac_consistency_threshold = args.nac_threshold,
        qualify_duration_s        = args.qualify_duration,
        cc_loss_timeout_s         = args.loss_timeout,
    )

    transport = ScannerTransport(config.serial_port, config.serial_baud)

    on_state_change, on_tgid_seen, on_cc_lost = _make_console_callbacks()

    hunter = ControlChannelHunter(
        transport        = transport,
        config           = config,
        on_state_change  = on_state_change,
        on_tgid_seen     = on_tgid_seen,
        on_cc_lost       = on_cc_lost,
    )

    # Clean shutdown on Ctrl-C or SIGTERM.
    def _shutdown(signum, frame):  # noqa: ARG001
        print("\nShutting down...")
        hunter.stop()
        transport.close()
        sys.exit(0)

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    hunter.start()
    hunter.join()


if __name__ == "__main__":
    main()
