import { Serial } from './SerialMonitor';

// ─── Demo / Synthetic Telemetry Generator ─────────────────────────────────────
// Emits realistic raw scanner lines through the SAME ingest path that real
// hardware uses (Serial.ingest), so rawListeners, the decoder, and the store all
// run exactly as they would with a live BCD325P2 — no open serial port required.
//
// IMPORTANT RADIX NOTE (see Decoder.ts): EDACS numeric tokens are parsed as HEX
// then converted to decimal for AgencyDB lookup. To make the decoder emit the
// DECIMAL talkgroup id "801", the synthetic line must contain the HEX token
// "TG-321" (0x321 === 801). The helper toHex() below converts a desired decimal
// DB key back to the hex token the decoder expects.
//
// P25 GLG lines use DECIMAL tgids directly (field [1]); no conversion needed.
// ──────────────────────────────────────────────────────────────────────────────

/** Convert a decimal DB key (string) to the uppercase hex token the decoder expects. */
function toHex(dec: string): string {
    return parseInt(dec, 10).toString(16).toUpperCase();
}

function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Real AgencyDB decimal keys so the leaderboard / cards show named agencies.
const EDACS_TGS = ['801', '802', '805', '609', '554', '555', '171', '299', '300', '250', '317'];
// A couple of EDACS ids deliberately NOT in the DB → exercise "Unknown" display.
const EDACS_TGS_UNKNOWN = ['1500', '4090'];
// Patch member ids that exist in the DB (decimal).
const PATCH_MEMBERS = ['801', '802', '832', '833', '835', '299', '300'];

// P25 GLG tgids: real DB decimal keys + a couple of unknown ones for NEW badges.
const P25_TGS_KNOWN = ['12301', '12302', '12401', '2057'];
const P25_TGS_UNKNOWN = ['58001', '58002'];

const P25_SYS = ['ACSO-P25', 'GPD-P25', 'Alachua-Co'];
const P25_GRP = ['Law Dispatch', 'Fire Ops', 'Tac 3', 'Common'];

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

        // Immediately announce the control channel so the UI leaves "AWAITING C-CH".
        this.emitSite();

        // Site re-announcement every ~8s.
        this.timers.push(window.setInterval(() => this.emitSite(), 8000));

        // EDACS voice grants — the busiest stream (drives feed + leaderboard + LCN map).
        this.timers.push(window.setInterval(() => this.emitGrant(), 900));

        // EDACS patches — slower; drives the patch matrix + TX flash.
        this.timers.push(window.setInterval(() => this.emitPatch(), 3500));

        // P25 GLG hits — drives the unified P25 cards + hold/skip logic.
        this.timers.push(window.setInterval(() => this.emitP25(), 1400));
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

    private emitSite() {
        // SIT- token is a hex display label; rotate the trailing nibble for variety.
        this.siteSeq = (this.siteSeq + 1) % 16;
        const tag = '1' + this.siteSeq.toString(16).toUpperCase();
        this.feed(`EDW SIT-${tag} CTRL-CH ACTIVE`);
    }

    private emitGrant() {
        // ~15% of grants use an id NOT in the DB so "Unknown" rows appear.
        const useUnknown = Math.random() < 0.15;
        const decTg = useUnknown ? pick(EDACS_TGS_UNKNOWN) : pick(EDACS_TGS);
        const lcn = 1 + Math.floor(Math.random() * 18);     // decimal logical channel
        const vc = 1 + Math.floor(Math.random() * 24);      // decimal voice channel
        const callType = pick(['CNM', 'CIP', 'CPT']);
        // LCN/VC tokens are also hex-decoded by the parser → emit them as hex.
        this.feed(
            `EDW ${callType} TG-${toHex(decTg)} LCN-${toHex(String(lcn))} VC-${toHex(String(vc))}`
        );
    }

    private emitPatch() {
        // Patch id is a hex display label; pick two distinct members.
        const patchId = (0x10 + Math.floor(Math.random() * 0x30)).toString(16).toUpperCase();
        const m1 = pick(PATCH_MEMBERS);
        let m2 = pick(PATCH_MEMBERS);
        if (m2 === m1) m2 = pick(PATCH_MEMBERS);
        // Two MEM lines so the patch accumulates >1 member.
        this.feed(`EDW PAT-${patchId} MEM-${toHex(m1)}`);
        if (m2 !== m1) {
            this.feed(`EDW PAT-${patchId} MEM-${toHex(m2)}`);
        }
    }

    private emitP25() {
        const useUnknown = Math.random() < 0.18;
        const tgid = useUnknown ? pick(P25_TGS_UNKNOWN) : pick(P25_TGS_KNOWN);
        const sys = pick(P25_SYS);
        const grp = pick(P25_GRP);
        const chan = `CH-${100 + Math.floor(Math.random() * 50)}`;
        const squelch = Math.random() < 0.7 ? '1' : '0';
        // GLG,[FRQ/TGID],[MOD],[ATT],[CTCSS],[SYS],[GRP],[CHAN],[SQL],[MUT],[NAC]
        // ≥10 comma fields; tgid in field [1] (decimal, used directly).
        this.feed(
            `GLG,${tgid},FM,0,0,${sys},${grp},${chan},${squelch},0,293`
        );
    }
}

export const Demo = new DemoFeed();
