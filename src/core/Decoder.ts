import type { EDACSEvent, PatchEvent, SiteEvent, GrantEvent, P25Event } from '../types';

// ─── Radix Decision ───────────────────────────────────────────────────────────
// The BCD325P2 EDACS control-channel output (EDW/EDN lines) encodes SIT-, PAT-,
// MEM-, TG-, CH-/LCN-, and VC- values as HEXADECIMAL strings (uppercase A-F).
// This matches the reference implementation in sentinel.html which does
// `parseInt(memM[1], 16)` on MEM tokens and uses the resulting decimal integer as
// a database key.  AgencyDB keys are decimal strings (e.g. "801").
// Therefore all hex token values must be parsed with parseInt(…, 16) and then
// converted to a decimal string before use as a DB key.  That is already what
// the code below does.  A leading-zero-free decimal toString() is always used so
// keys match the literals in AgencyDB.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a hex token string from the control stream to a decimal string key. */
function hexToDec(hex: string): string {
    return parseInt(hex, 16).toString(10);
}

export class ScannerDecoder {
    static parseEDACS(line: string): EDACSEvent | null {
        // Quick pre-filter: only process EDACS control-channel lines.
        // EDW/EDN prefixes identify the line type; the specific token checks
        // (SIT-, PAT-, TG-) are sufficient without the redundant startsWith guards.
        const isEdacs =
            line.includes("EDW") ||
            line.includes("EDN") ||
            line.includes("SIT-") ||
            line.includes("PAT-") ||
            line.includes("TG-");

        if (!isEdacs) return null;

        const timestamp = Date.now();

        // ── Site ──────────────────────────────────────────────────────────────
        const sitM = line.match(/SIT-([0-9A-Fa-f]+)/);
        if (sitM) {
            return {
                type: 'SITE',
                siteId: sitM[1],      // kept as hex label, display only
                raw: line,
                timestamp
            } as SiteEvent;
        }

        // ── Patch ─────────────────────────────────────────────────────────────
        const patM = line.match(/PAT-([0-9A-Fa-f]+)/);
        const memM = line.match(/MEM-([0-9A-Fa-f]+)/);
        if (patM && memM) {
            return {
                type: 'PATCH',
                patchId: patM[1],              // hex label used as patch display ID
                memberId: hexToDec(memM[1]),   // decimal string → matches AgencyDB key
                raw: line,
                timestamp
            } as PatchEvent;
        }

        // ── Voice Grant ───────────────────────────────────────────────────────
        // CNM = confirmed voice grant; CIP/CIV = individual call; CPT = patch call.
        const isGrant =
            line.includes("TG-") ||
            line.includes("CNM") ||
            line.includes("CIP") ||
            line.includes("CIV") ||
            line.includes("CPT");

        if (isGrant) {
            const tgM  = line.match(/TG-([0-9A-Fa-f]+)/);
            const chM  = line.match(/(?:CH|LCN)-([0-9A-Fa-f]+)/);
            const vcM  = line.match(/VC-([0-9A-Fa-f]+)/);
            const uM   = line.match(/(?:U|TGR)-([0-9A-Fa-f]+)/);

            let grantType: GrantEvent['grantType'] = 'UNKNOWN';
            if (line.includes("CPT"))                             grantType = 'CPT';
            else if (line.includes("CIP") || line.includes("CIV")) grantType = 'ICALL';
            else if (line.includes("CNM") || line.includes("TG-")) grantType = 'TG';

            if (tgM || chM || vcM) {
                return {
                    type: 'GRANT',
                    grantType,
                    // All numeric IDs converted hex → decimal string to match AgencyDB keys.
                    talkgroupId:    tgM ? hexToDec(tgM[1])  : undefined,
                    logicalChannel: chM ? hexToDec(chM[1])  : undefined,
                    voiceChannel:   vcM ? hexToDec(vcM[1])  : undefined,
                    unitId:         uM  ? hexToDec(uM[1])   : undefined,
                    raw: line,
                    timestamp
                } as GrantEvent;
            }
        }

        return { type: 'UNKNOWN', raw: line, timestamp };
    }

    // ── GLG / P25 parser ──────────────────────────────────────────────────────
    // Protocol: GLG,[FRQ/TGID],[MOD],[ATT],[CTCSS/DCS],[NAME1],[NAME2],[NAME3],
    //               [SQL],[MUT],[SYS_TAG],[CHAN_TAG],[P25NAC]
    // indices:        0       1     2    3      4         5       6       7
    //                 8    9      10        11       12
    static parseP25(line: string): P25Event | null {
        if (!line.startsWith("GLG,")) return null;
        const parts = line.split(',');
        if (parts.length < 10) return null;

        const tgid = parts[1];
        if (!tgid || tgid.trim() === "") return null;

        return {
            tgid,
            systemName:   parts[5]?.trim() || "",
            groupName:    parts[6]?.trim() || "",
            channelName:  parts[7]?.trim() || "",
            isSquelchOpen: parts[8] === "1",
            timestamp: Date.now()
        };
    }
}
