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

// Legacy EDACS talkgroups (decimal) for the EDACS dashboard demo.
const EDACS_TGS = ['801', '802', '805', '609', '554', '171', '299'];
const EDACS_TGS_UNKNOWN = ['1500', '4090'];
const PATCH_MEMBERS = ['801', '802', '832', '299', '300'];

/** Random P25 voice-channel frequency in the 851–853 MHz band as an 8-digit token. */
function randomVc(): string {
    const band = pick(['0851', '0852', '0853']);
    const tail = String(1000 + Math.floor(Math.random() * 8999)); // 4 digits
    return band + tail; // e.g. "08527750"
}

export class DemoFeed {
    private timers: number[] = [];
    private running = false;
    private siteSeq = 0;

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

        // Legacy EDACS streams for the EDACS dashboard.
        this.emitSite();
        this.timers.push(window.setInterval(() => this.emitSite(), 8000));
        this.timers.push(window.setInterval(() => this.emitGrant(), 1500));
        this.timers.push(window.setInterval(() => this.emitPatch(), 3500));
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

    // ── Legacy EDACS emitters ───────────────────────────────────────────────────

    private emitSite() {
        this.siteSeq = (this.siteSeq + 1) % 16;
        const tag = '1' + this.siteSeq.toString(16).toUpperCase();
        this.feed(`EDW SIT-${tag} CTRL-CH ACTIVE`);
    }

    private emitGrant() {
        const useUnknown = Math.random() < 0.15;
        const decTg = useUnknown ? pick(EDACS_TGS_UNKNOWN) : pick(EDACS_TGS);
        const lcn = 1 + Math.floor(Math.random() * 18);
        const vc = 1 + Math.floor(Math.random() * 24);
        const callType = pick(['CNM', 'CIP', 'CPT']);
        this.feed(
            `EDW ${callType} TG-${toHex(decTg)} LCN-${toHex(String(lcn))} VC-${toHex(String(vc))}`
        );
    }

    private emitPatch() {
        const patchId = (0x10 + Math.floor(Math.random() * 0x30)).toString(16).toUpperCase();
        const m1 = pick(PATCH_MEMBERS);
        let m2 = pick(PATCH_MEMBERS);
        if (m2 === m1) m2 = pick(PATCH_MEMBERS);
        this.feed(`EDW PAT-${patchId} MEM-${toHex(m1)}`);
        if (m2 !== m1) {
            this.feed(`EDW PAT-${patchId} MEM-${toHex(m2)}`);
        }
    }
}

export const Demo = new DemoFeed();
