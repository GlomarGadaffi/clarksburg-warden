import { Serial } from './SerialMonitor';

// ─── Demo / Synthetic Telemetry Generator ─────────────────────────────────────
// Emits realistic raw scanner lines through the SAME ingest path that real
// hardware uses (Serial.ingest), so rawListeners, the decoder, and the store all
// run exactly as they would with a live BCD325P2 — no open serial port required.
//
// The line formats below mirror REAL captures from a BCD325P2 monitoring the
// Alachua/Gainesville SLERS-P25 system (WACN BEE00 / SID 04D9), plus legacy
// EDACS lines so the EDACS dashboard also demos.
//
// RADIX (see Decoder.ts): EDACS + P25 numeric tokens (TG-/CH-/MEM-/VC- TG ids)
// are HEX; the decoder converts to decimal for AgencyDB lookup. toHex() turns a
// decimal DB key back into the hex token the parser expects. P25 GLG tgids are
// decimal and used directly. P25 CNM VC- is an 8-digit frequency (852.7750 MHz
// → "08527750").
// ──────────────────────────────────────────────────────────────────────────────

/** Convert a decimal DB key (string) to the uppercase hex token the decoder expects. */
function toHex(dec: string): string {
    return parseInt(dec, 10).toString(16).toUpperCase();
}

function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Real SLERS-P25 talkgroups (decimal). GLG path → tactical cards.
const P25_TGS_KNOWN = ['2057', '2147', '2161'];     // GPD A1, ACSO A1, ACSO B14
const P25_TGS_UNKNOWN = ['2105', '2109', '3097'];   // observed; some unnamed → NEW badge
const P25_SYS = ['Simulcast'];
const P25_GRP = ['Alachua County S', 'Gainesville Poli'];
const P25_CHAN = ['ACSO A1', 'ACSO B14', 'GPD A1'];

// EDACS patches: real SLERS supergroups + member talkgroups (decimal AgencyDB
// keys) so the patch matrix resolves to named FHP agencies.
const EDACS_PATCHES: { p: string; m: string[] }[] = [
    { p: '78',   m: ['1058', '1089', '1138', '1154'] }, // FHP Troop B
    { p: '35',   m: ['250', '317', '577', '609'] },     // FHP Troop C
    { p: '230',  m: ['231', '249', '1352'] },           // FHP Turnpike
];

/** Zero-pad a hex token to 4 chars (e.g. "4E" → "004E"). */
function pad4(hex: string): string {
    return ('0000' + hex).slice(-4);
}

/** Random P25 voice-channel frequency in the 851–853 MHz band as an 8-digit token. */
function randomVc(): string {
    const band = pick(['0851', '0852', '0853']);
    const tail = String(1000 + Math.floor(Math.random() * 8999)); // 4 digits
    return band + tail; // e.g. "08527750"
}

export class DemoFeed {
    private timers: number[] = [];
    private running = false;

    get isRunning() {
        return this.running;
    }

    start() {
        if (this.running) return;
        this.running = true;

        // P25 system identity so the Unified panel shows WACN / SysID / Site.
        this.emitSystemId();
        this.timers.push(window.setInterval(() => this.emitSystemId(), 6000));

        // P25 reception status (GLG) → tactical grid cards.
        this.timers.push(window.setInterval(() => this.emitP25Glg(), 1300));

        // P25 control-channel voice grants (CNM) → grant feed with frequencies.
        this.timers.push(window.setInterval(() => this.emitP25Grant(), 1100));

        // EDACS streams (real SLERS OSW format) for the EDACS dashboard.
        this.emitSite();
        this.timers.push(window.setInterval(() => this.emitSite(), 3000));
        this.timers.push(window.setInterval(() => this.emitPatch(), 1600));
    }

    stop() {
        this.running = false;
        for (const id of this.timers) clearInterval(id);
        this.timers = [];
    }

    // ── Emitters ───────────────────────────────────────────────────────────────

    private feed(line: string) {
        // Route through the identical real-data pipeline.
        Serial.ingest(line + '\r\n');
    }

    // P25: system identity frames (SID / WACN), occasionally glued to a GLG echo
    // exactly as the real scanner does, to exercise ingest() re-segmentation.
    private emitSystemId() {
        this.feed('P25,3A000034D90102015D70C4C5,SID-04D9 SUB-01 SIT-02');
        this.feed('P25,3B0000BEE004D9015D700112,WACN-BEE00GLG,,,,,,,,,,,,');
    }

    // P25: GLG reception status for the tactical grid.
    private emitP25Glg() {
        const useUnknown = Math.random() < 0.18;
        const tgid = useUnknown ? pick(P25_TGS_UNKNOWN) : pick(P25_TGS_KNOWN);
        const sys = pick(P25_SYS);
        const grp = pick(P25_GRP);
        const chan = pick(P25_CHAN);
        const squelch = Math.random() < 0.7 ? '1' : '0';
        this.feed(`GLG,${tgid},NFM,0,0,${sys},${grp},${chan},${squelch},0,NONE,NONE,NONE`);
    }

    // P25: CNM voice channel grant(s). ~30% of the time the scanner emits the grant
    // twice on one line (real behaviour) — the decoder de-duplicates.
    private emitP25Grant() {
        const useUnknown = Math.random() < 0.25;
        const tg = useUnknown ? pick(P25_TGS_UNKNOWN) : pick(P25_TGS_KNOWN);
        const chHex = (0x100 + Math.floor(Math.random() * 0xFF)).toString(16).toUpperCase();
        const vc = randomVc();
        const grant = `CNM TG-${toHex(tg)} CH-${chHex} VC-${vc}`;
        const annotation = Math.random() < 0.3 ? `${grant},${grant}` : grant;
        this.feed(`P25,02000121086301C908099C2F,${annotation}`);
    }

    // ── EDACS emitters (real SLERS OSW format) ──────────────────────────────────
    // Format mirrors live captures: EDW,<half>,<MT>,<24-bit payload>,<scanner tags>

    private emitSite() {
        // MT 0x17 site OSW, tagged SIT-2F by the scanner (site 0x2F).
        const half = Math.random() < 0.5 ? '0' : '1';
        this.feed(`EDW,${half},17,16312F,SIT-2F`);
    }

    private emitPatch() {
        // Real patch supergroups + members (decimal AgencyDB ids). The scanner
        // emits PAT-/MEM- as zero-padded hex; the payload low bytes carry MEM.
        const grp = pick(EDACS_PATCHES);
        const mem = pick(grp.m);
        const memHex = pad4(toHex(mem));
        const payload = ('00' + memHex).slice(-6);
        this.feed(`EDW,1,2C,${payload},PAT-${pad4(toHex(grp.p))} MEM-${memHex}`);
    }
}

export const Demo = new DemoFeed();
