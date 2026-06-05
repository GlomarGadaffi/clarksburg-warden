import type { EDACSEvent, PatchEvent, SiteEvent, GrantEvent, UnitEvent, P25Event } from '../types';

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

/**
 * Format a P25 VC- voice-channel token (8-digit, units of 100 Hz, e.g.
 * "08527750") as a human-readable frequency string ("852.7750 MHz").
 */
function formatVcFreq(vc: string): string {
    const mhz = Number(vc) / 10000;
    return Number.isFinite(mhz) ? `${mhz.toFixed(4)} MHz` : vc;
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
            // Validated against live SLERS EDACS: "PAT-004E MEM-0422" → patch 78
            // (FHP Troop B Patch/Talk) + member 1058 (FHP Troop B Law Tac), both
            // AgencyDB hits — so BOTH ids are hex and must be converted to decimal.
            return {
                type: 'PATCH',
                patchId: hexToDec(patM[1]),    // decimal string → matches AgencyDB key
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
                    source: 'EDACS',
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

        // ── Unit / group ID activity ────────────────────────────────────────────
        // Real OSW form: EDW,<half>,<MT>,<24-bit payload>,<tag>[,<tag>]. A "UN"/"PN"
        // tagged OSW whose payload is a bare LID (high byte zero, value ≤ 0x1FFF)
        // is a group/unit appearing on the control channel — e.g.
        // "EDW,1,0C,000343,UN" → 0x343 = 835 (FHP Troop A Law Tac). Site/system
        // frames (16312F, 007EEB) and call assignments (081777) have larger or
        // high-byte payloads and are excluded by the range gate.
        const parts = line.split(',');
        if (parts[0] === 'EDW' && parts.length >= 5) {
            const mt = parts[2];
            const payload = parts[3];
            const tags = parts.slice(4).map(t => t.trim());
            const tagged = tags.includes('UN') || tags.includes('PN');
            if (tagged && /^[0-9A-Fa-f]+$/.test(payload)) {
                const val = parseInt(payload, 16);
                if (val > 0 && val <= 0x1FFF) {
                    return {
                        type: 'UNIT',
                        id: val.toString(10),
                        mt,
                        raw: line,
                        timestamp
                    } as UnitEvent;
                }
            }
        }

        return { type: 'UNKNOWN', raw: line, timestamp };
    }

    // ── P25 raw control-channel frame parser ────────────────────────────────────
    // When "C-CH Output: Extend" is enabled the BCD325P2 dumps decoded P25 trunk
    // control frames as:  P25,<24-hex-payload>,<annotation>
    // Observed actionable annotations (everything is HEX unless noted):
    //   CNM TG-<tg> CH-<ch> VC-<freq>   group voice channel grant. The annotation
    //                                   field may contain TWO comma-separated CNM
    //                                   grants, sometimes duplicated, so we regex-
    //                                   extract rather than comma-split.
    //   SID-<id> SUB-<n> SIT-<site>     system / subsystem / site identity
    //   WACN-<wacn>                     Wide Area Communications Network id
    //   PN / UN                         bare P25 NID/sync tags — not actionable.
    //   IU / IUTDMA N-.. B-.. S-..      unit activity on a traffic channel — parsed
    //                                   for completeness is intentionally skipped to
    //                                   avoid flooding the grant feed with cryptic ids.
    // Returns zero or more typed events (a single line can yield several).
    static parseP25Frame(line: string): EDACSEvent[] {
        if (!line.startsWith("P25,")) return [];
        const timestamp = Date.now();
        const events: EDACSEvent[] = [];

        // Group voice channel grants. De-duplicate identical grants within a line.
        const seen = new Set<string>();
        const grantRe = /CNM TG-([0-9A-Fa-f]+) CH-([0-9A-Fa-f]+) VC-(\d+)/g;
        let m: RegExpExecArray | null;
        while ((m = grantRe.exec(line)) !== null) {
            const key = `${m[1]}|${m[2]}|${m[3]}`;
            if (seen.has(key)) continue;
            seen.add(key);
            events.push({
                type: 'GRANT',
                grantType: 'TG',
                source: 'P25',
                talkgroupId:    hexToDec(m[1]),
                logicalChannel: hexToDec(m[2]),
                voiceChannel:   m[3],                 // raw VC digits (for CSV/LCN map)
                frequency:      formatVcFreq(m[3]),   // "852.7750 MHz" for display
                raw: line,
                timestamp
            } as GrantEvent);
        }

        // System identity. SID/WACN/SIT usually arrive on separate frames, so emit
        // a SITE event carrying whichever field(s) this line contains.
        const sidM  = line.match(/SID-([0-9A-Fa-f]+)/);
        const wacnM = line.match(/WACN-([0-9A-Fa-f]+)/);
        const sitM  = line.match(/SIT-(\d+)/);
        if (sidM || wacnM || sitM) {
            events.push({
                type: 'SITE',
                siteId: sitM ? sitM[1] : (sidM ? sidM[1] : ''),
                sysId:  sidM  ? sidM[1]  : undefined,
                wacn:   wacnM ? wacnM[1] : undefined,
                site:   sitM  ? sitM[1]  : undefined,
                raw: line,
                timestamp
            } as SiteEvent);
        }

        return events;
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
