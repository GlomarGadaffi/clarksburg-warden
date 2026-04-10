import type { EDACSEvent, PatchEvent, SiteEvent, GrantEvent, P25Event } from '../types';

export class ScannerDecoder {
    static parseEDACS(line: string): EDACSEvent | null {
        if (!line.startsWith("EDW") && !line.startsWith("EDN") && !line.includes("EDW") && !line.includes("SIT-") && !line.includes("PAT-") && !line.includes("TG-")) {
            return null;
        }

        const timestamp = Date.now();
        
        // Site parsing
        const sitM = line.match(/SIT-([0-9A-F]+)/);
        if (sitM) {
            return { type: 'SITE', siteId: sitM[1], raw: line, timestamp } as SiteEvent;
        }

        // Patch parsing
        const patM = line.match(/PAT-([0-9A-F]+)/);
        const memM = line.match(/MEM-([0-9A-F]+)/);
        if (patM && memM) {
            return { 
                type: 'PATCH', 
                patchId: patM[1], 
                memberId: parseInt(memM[1], 16).toString(), 
                raw: line, 
                timestamp 
            } as PatchEvent;
        }

        // Voice Grants
        const isGrant = line.includes("TG-") || line.includes("CNM") || line.includes("CIP") || line.includes("CIV");
        if (isGrant) {
            const tgM = line.match(/TG-([0-9A-Fa-f]+)/);
            const chM = line.match(/CH-([0-9A-Fa-f]+)|LCN-([0-9A-Fa-f]+)/);
            const vcM = line.match(/VC-([0-9A-Fa-f]+)/);
            const uM = line.match(/U-([0-9A-Fa-f]+)|TGR-([0-9A-Fa-f]+)/);
            
            let grantType: 'TG' | 'ICALL' | 'CPT' | 'UNKNOWN' = 'UNKNOWN';
            if (line.includes("CNM") || line.includes("TG-")) grantType = 'TG';
            if (line.includes("CIP") || line.includes("CIV") || line.includes("U-")) grantType = 'ICALL';
            if (line.includes("CPT")) grantType = 'CPT';

            if (tgM || chM || vcM) {
                return {
                    type: 'GRANT',
                    grantType,
                    talkgroupId: tgM ? parseInt(tgM[1], 16).toString() : undefined,
                    logicalChannel: chM ? (chM[1] || chM[2]) : undefined,
                    voiceChannel: vcM ? vcM[1] : undefined,
                    unitId: uM ? (uM[1] || uM[2]) : undefined,
                    raw: line,
                    timestamp
                } as GrantEvent;
            }
        }

        return { type: 'UNKNOWN', raw: line, timestamp };
    }

    static parseP25(line: string): P25Event | null {
        if (!line.startsWith("GLG,")) return null;
        const parts = line.split(',');
        if (parts.length < 10) return null;

        const tgid = parts[1];
        if (!tgid || tgid.trim() === "") return null;

        return {
            tgid,
            isSquelchOpen: parts[8] === "1",
            systemName: parts[5]?.trim() || "",
            groupName: parts[6]?.trim() || "",
            channelName: parts[7]?.trim() || "",
            timestamp: Date.now()
        };
    }
}
