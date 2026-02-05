# BearSentinel# SENTINEL

**Unified Intelligence Platform for BCD325P2 Scanner Monitoring**

A single-file, browser-based dashboard for real-time monitoring of Florida's SLERS/EDACS and Alachua County P25 trunked radio systems via USB serial. Built on the Web Serial API — no backend, no dependencies, no install.

BearSentinel DOES NOT decrypt or decode encrypted voice traffic on SLERS (which often uses ESK for voice encryption), but it absolutely can track and display metadata for those encrypted talkgroups via the control channel data, which remains in the clear on EDACS systems. This includes things like active talkgroup IDs, patches, member affiliations, hit counts, and activity leaderboards, even when the actual audio is inaccessible.The core purpose here is enhanced situational awareness: visualizing the "big picture" of system activity and dynamic patches across SLERS, regardless of encryption on the voice side. 

![HTML5](https://img.shields.io/badge/HTML5-single_file-E34F26?logo=html5&logoColor=white)
![Web Serial](https://img.shields.io/badge/Web_Serial-API-4285F4?logo=googlechrome&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

---

## What It Does

Sentinel connects directly to a Uniden BCD325P2 scanner over USB and provides a dual-panel operational dashboard:

- **SLERS/EDACS Panel** — Decodes control channel output (`EDW` frames), builds a live patch matrix showing which talkgroups are bridged together, tracks per-member activity, and maintains a rolling leaderboard with 5-minute and 60-minute hit windows.

- **P25 Panel** — Polls the scanner via `GLG` commands at 150ms intervals, displays active talkgroup information on an LCD-style readout, populates a tactical card grid with session and all-time hit counts, and supports click-to-hold for locking onto a specific channel.

Both panels auto-expire stale data (30s for SLERS patches, 5m for P25 cards) and persist hit statistics to `localStorage` across sessions.

---

## Requirements

| Requirement | Detail |
|---|---|
| **Scanner** | Uniden BCD325P2 (or compatible model supporting serial `GLG` polling and `EDW` control channel output) |
| **Browser** | Chrome 89+ or Edge 89+ (Web Serial API required) |
| **Cable** | USB cable to scanner |
| **Scanner Config** | "C-CH Output" enabled for SLERS/EDACS panel functionality |

> **Note:** Firefox and Safari do not support the Web Serial API.

---

## Usage

1. **Open `sentinel.html`** in Chrome or Edge. That's the entire app — one file, zero build steps.

2. **Connect the scanner** via USB and click **Connect USB** in the header. The browser will prompt for port selection.

3. **SLERS data** populates automatically when the scanner's control channel output is enabled. Patch cards appear as `EDW` frames arrive, with member talkgroups resolved against the built-in database.

4. **P25 data** populates as the scanner sweeps talkgroups. The dashboard auto-skips through channels to collect metadata (sweep mode). Click any talkgroup card to **hold** on that channel — the scanner will lock audio and stop skipping.

5. **Click a held card again** to release and resume scanning.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  BROWSER (Chrome/Edge)                              │
│                                                     │
│  ┌──────────┐    ┌──────────┐    ┌───────────────┐  │
│  │ Web      │───▶│ Line     │───▶│ Router        │  │
│  │ Serial   │    │ Buffer   │    │               │  │
│  │ API      │◀───│          │    │ EDW ──▶ SLERS │  │
│  │          │    └──────────┘    │ GLG ──▶ P25   │  │
│  │ 115200   │                    └───────────────┘  │
│  │ baud     │    ┌──────────┐                       │
│  │          │◀───│ Command  │◀── GLG poll (150ms)   │
│  │          │    │ Queue    │◀── KEY,H,P / KEY,S,P  │
│  └──────────┘    └──────────┘                       │
│                                                     │
│  ┌─────────────────────┬────────────────────────┐   │
│  │ SLERS PANEL         │ P25 PANEL              │   │
│  │                     │                        │   │
│  │ • Patch Matrix      │ • LCD Display          │   │
│  │ • Member Lists      │ • Tactical Card Grid   │   │
│  │ • Rolling Tally     │ • Click-to-Hold        │   │
│  │   (5m / 60m)        │ • Sweep Auto-Skip      │   │
│  └─────────────────────┴────────────────────────┘   │
│                                                     │
│  localStorage ◀──▶ Persistent Hit Counters          │
└─────────────────────────────────────────────────────┘
```

---

## Features

### Serial Layer
- Web Serial API connection at 115200 baud
- `\r`-terminated command writes with busy-flag acknowledgment
- Serialized command queue (prevents write collisions)
- TextDecoderStream read loop with CR/LF line buffering

### SLERS / EDACS
- Parses `EDW` frames for site ID (`SIT-`), patch ID (`PAT-`), and member ID (`MEM-`)
- Hex-to-decimal member ID conversion
- Patch cards accumulate member lists with agency-colored borders
- TX flash animation on activity
- 30-second TTL auto-cleanup for inactive patches
- Rolling talkgroup leaderboard with 5-minute and 60-minute sliding windows
- Session hits + persistent all-time counters

### P25 / Alachua
- 150ms `GLG` polling for real-time talkgroup tracking
- LCD display showing TGID, channel name, and agency
- Tactical card grid sorted by most-recent activity
- 2-second debounce to suppress Uniden log spam
- **Sweep mode**: auto-skips channels via `KEY,S,P` to maximize metadata collection
- **Click-to-hold**: locks scanner audio on a talkgroup via `KEY,H,P`, red pulse animation
- New discovery detection for talkgroups not in the database (falls back to GLG field data)
- 5-minute TTL with live age display per card
- Session + persistent all-time hit tracking

### Agency Database
Embedded database covering Florida statewide systems:

| Code | Agency | Examples |
|---|---|---|
| `INT` | Interagency / Statewide | IA channels, US Marshal JTF |
| `FHP` | Florida Highway Patrol | Troops A, B, C, D/K, Turnpike |
| `FWC` | Fish & Wildlife Commission | Wildlife Ops, Ocala Region |
| `FDLE` | FL Dept of Law Enforcement | Intel Ops, Fire Marshal |
| `LOC` | Local Agencies | County SO, municipal PD, fire, EMS |
| `TEC` | Radio Technicians | MA/COM, Microwave/NOC |

Each agency maps to a distinct color throughout the UI (card borders, leaderboard pips, member rows).

### Persistence
- Hit counters saved to `localStorage` with 5-second debounced writes
- Separate keys: `sentinel_p25`, `sentinel_slers`
- Survives page reloads and browser restarts
- Manual wipe via **Wipe DB** button

---

## Scanner Configuration

For full functionality with the BCD325P2:

1. **Enable C-CH Output**: `Menu → Settings → Serial Port → C-CH Output → On` — required for SLERS/EDACS patch data.
2. **Serial Port Baud**: Ensure scanner is set to **115200 baud** (default for USB).
3. **Programming**: Talkgroups should be programmed into scan lists as normal. The dashboard reads whatever the scanner is actively receiving.

---

## Customization

### Adding Talkgroups

Edit the `DB` object at the top of the `<script>` block:

```javascript
const DB = {
    "12301": { a: "LOC", n: "ACSO Dispatch 1" },
    "99999": { a: "FHP", n: "My Custom Channel" },
    // ...
};
```

- `a` — Agency code (`FHP`, `FDLE`, `FWC`, `LOC`, `INT`, `TEC`)
- `n` — Human-readable channel name

Unknown talkgroups are auto-detected and displayed with metadata extracted from the scanner's GLG response fields.

### Timing Adjustments

| Constant | Location | Default | Purpose |
|---|---|---|---|
| GLG poll rate | `setInterval(() => this.queueCmd("GLG"), ...)` | 150ms | Scanner query frequency |
| P25 debounce | `now - this.p25.lastTime > ...` | 2000ms | Duplicate suppression |
| P25 card TTL | `diff > 300000` | 5 min | Card expiration |
| SLERS patch TTL | `diff > 30000` | 30 sec | Patch expiration |
| Save debounce | `setTimeout(..., 5000)` | 5 sec | localStorage write interval |

---

## Browser Compatibility

| Browser | Supported | Notes |
|---|---|---|
| Chrome 89+ | ✅ | Full support |
| Edge 89+ | ✅ | Full support |
| Opera 75+ | ✅ | Chromium-based |
| Firefox | ❌ | No Web Serial API |
| Safari | ❌ | No Web Serial API |

---

## License

MIT
