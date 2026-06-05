import { describe, it, expect } from 'vitest';
import { ScannerDecoder } from './Decoder';
import type { SiteEvent, PatchEvent, GrantEvent } from '../types';

// These tests lock in the EDACS/P25 parsing contract. The single most important
// invariant: numeric EDACS tokens (MEM/TG/CH/LCN/VC/U) are parsed as HEX and
// emitted as DECIMAL strings, because AgencyDB keys are decimal strings.

describe('ScannerDecoder.parseEDACS', () => {
    describe('SITE', () => {
        it('extracts the site id as a hex display label (not converted)', () => {
            const ev = ScannerDecoder.parseEDACS('EDW SIT-1A') as SiteEvent;
            expect(ev).not.toBeNull();
            expect(ev.type).toBe('SITE');
            // siteId is intentionally kept as the raw hex label for display.
            expect(ev.siteId).toBe('1A');
            expect(ev.raw).toBe('EDW SIT-1A');
            expect(typeof ev.timestamp).toBe('number');
        });

        it('takes precedence over patch/grant when SIT- is present', () => {
            // SITE is matched first; even with other tokens present it wins.
            const ev = ScannerDecoder.parseEDACS('EDW SIT-2B TG-321');
            expect(ev?.type).toBe('SITE');
        });
    });

    describe('PATCH', () => {
        it('converts MEM hex token to a decimal string (MEM-321 -> "801")', () => {
            const ev = ScannerDecoder.parseEDACS('EDW PAT-7 MEM-321') as PatchEvent;
            expect(ev).not.toBeNull();
            expect(ev.type).toBe('PATCH');
            // Both patchId and memberId are hex->dec.
            expect(ev.patchId).toBe('7');
            expect(ev.memberId).toBe('801'); // parseInt('321',16) === 801
        });

        // Real comma-delimited EDACS OSW lines captured from a live SLERS site.
        it('parses the real "EDW,<half>,<MT>,<payload>,<tags>" format', () => {
            const ev = ScannerDecoder.parseEDACS('EDW,1,2C,000422,PAT-004E MEM-0422') as PatchEvent;
            expect(ev.type).toBe('PATCH');
            expect(ev.patchId).toBe('78');    // 0x004E — FHP Troop B Patch/Talk
            expect(ev.memberId).toBe('1058'); // 0x0422 — FHP Troop B Law Tac
        });

        it('decodes a real SLERS site OSW (EDW,0,17,16312F,SIT-2F)', () => {
            const ev = ScannerDecoder.parseEDACS('EDW,0,17,16312F,SIT-2F');
            expect(ev?.type).toBe('SITE');
            expect((ev as { siteId: string }).siteId).toBe('2F');
        });
    });

    describe('UNIT activity', () => {
        it('decodes a UN-tagged unit/group OSW to a decimal LID', () => {
            // 0x343 = 835 = FHP Troop A Law Tac (validated against AgencyDB).
            const ev = ScannerDecoder.parseEDACS('EDW,1,0C,000343,UN,UN') as { type: string; id: string; mt: string };
            expect(ev.type).toBe('UNIT');
            expect(ev.id).toBe('835');
            expect(ev.mt).toBe('0C');
        });

        it('does NOT treat the system-ID frame as a unit (payload > 0x1FFF)', () => {
            // 0x7EEB = 32491 is the SLERS system id, not a group LID.
            const ev = ScannerDecoder.parseEDACS('EDW,0,17,007EEB,UN');
            expect(ev?.type).toBe('UNKNOWN');
        });

        it('does NOT treat a call-assignment OSW (non-zero high byte) as a unit', () => {
            const ev = ScannerDecoder.parseEDACS('EDW,0,16,081777,UN');
            expect(ev?.type).toBe('UNKNOWN');
        });

        it('requires BOTH PAT- and MEM- to classify as PATCH', () => {
            // PAT- alone (no MEM-) is not a patch; falls through to UNKNOWN.
            const ev = ScannerDecoder.parseEDACS('EDW PAT-7');
            expect(ev?.type).toBe('UNKNOWN');
        });

        it('memberId decimal conversion matches an AgencyDB key (801 = FHP)', () => {
            // 0x321 -> 801, which is a real DB key. This is the lookup-hit invariant.
            const ev = ScannerDecoder.parseEDACS('EDN PAT-1 MEM-321') as PatchEvent;
            expect(ev.memberId).toBe('801');
        });
    });

    describe('GRANT', () => {
        it('parses TG/LCN/VC with hex->dec conversion and grantType TG', () => {
            const ev = ScannerDecoder.parseEDACS('EDW TG-321 LCN-5 VC-12') as GrantEvent;
            expect(ev).not.toBeNull();
            expect(ev.type).toBe('GRANT');
            expect(ev.grantType).toBe('TG');           // TG- present
            expect(ev.talkgroupId).toBe('801');         // 0x321 -> 801
            expect(ev.logicalChannel).toBe('5');        // 0x5  -> 5
            expect(ev.voiceChannel).toBe('18');         // 0x12 -> 18
            expect(ev.unitId).toBeUndefined();
        });

        it('classifies CNM (with TG) as TG', () => {
            const ev = ScannerDecoder.parseEDACS('EDW CNM TG-32 LCN-1') as GrantEvent;
            expect(ev.grantType).toBe('TG');
            expect(ev.talkgroupId).toBe('50'); // 0x32 -> 50
        });

        it('classifies CIP / CIV individual calls as ICALL', () => {
            const cip = ScannerDecoder.parseEDACS('EDW CIP U-A LCN-2') as GrantEvent;
            expect(cip.grantType).toBe('ICALL');
            expect(cip.unitId).toBe('10'); // 0xA -> 10

            const civ = ScannerDecoder.parseEDACS('EDW CIV TG-1 LCN-2') as GrantEvent;
            expect(civ.grantType).toBe('ICALL');
        });

        it('classifies CPT patch calls as CPT (CPT wins over TG)', () => {
            // CPT is checked before TG, so a line with both is classified CPT.
            const ev = ScannerDecoder.parseEDACS('EDW CPT TG-1 LCN-3') as GrantEvent;
            expect(ev.grantType).toBe('CPT');
        });

        it('returns a GRANT when at least one of TG/CH/VC is present', () => {
            const ev = ScannerDecoder.parseEDACS('EDW CNM CH-7') as GrantEvent;
            expect(ev.type).toBe('GRANT');
            expect(ev.logicalChannel).toBe('7');
            expect(ev.talkgroupId).toBeUndefined();
        });

        it('accepts CH- as an alias for LCN-', () => {
            const ev = ScannerDecoder.parseEDACS('EDW TG-10 CH-A') as GrantEvent;
            expect(ev.logicalChannel).toBe('10'); // 0xA -> 10
        });

        it('falls back to UNKNOWN when a grant keyword has no TG/CH/VC tokens', () => {
            // CNM keyword but no extractable numeric token -> UNKNOWN, not GRANT.
            const ev = ScannerDecoder.parseEDACS('EDW CNM only');
            expect(ev?.type).toBe('UNKNOWN');
        });
    });

    describe('null / UNKNOWN handling', () => {
        it('returns null for non-EDACS lines', () => {
            expect(ScannerDecoder.parseEDACS('GLG,801,FM,0,,SYS,GRP,CH,1,0')).toBeNull();
            expect(ScannerDecoder.parseEDACS('random noise')).toBeNull();
            expect(ScannerDecoder.parseEDACS('')).toBeNull();
        });

        it('returns UNKNOWN for an EDACS line with no recognizable payload', () => {
            const ev = ScannerDecoder.parseEDACS('EDW heartbeat');
            expect(ev?.type).toBe('UNKNOWN');
            expect(ev?.raw).toBe('EDW heartbeat');
        });
    });
});

describe('ScannerDecoder.parseP25', () => {
    // GLG,[TGID],[MOD],[ATT],[CTCSS],[NAME1],[NAME2],[NAME3],[SQL],[MUT],...
    const valid = 'GLG,801,FM,0,,SystemA,GroupB,ChannelC,1,0,TAG,CTAG';

    it('parses a valid GLG line with >=10 fields', () => {
        const ev = ScannerDecoder.parseP25(valid);
        expect(ev).not.toBeNull();
        expect(ev!.tgid).toBe('801');           // raw, not hex-converted for P25
        expect(ev!.systemName).toBe('SystemA');  // field[5]
        expect(ev!.groupName).toBe('GroupB');    // field[6]
        expect(ev!.channelName).toBe('ChannelC');// field[7]
        expect(ev!.isSquelchOpen).toBe(true);    // field[8] === '1'
    });

    it('treats squelch as closed when field[8] is not exactly "1"', () => {
        const closed = 'GLG,801,FM,0,,SystemA,GroupB,ChannelC,0,0';
        expect(ScannerDecoder.parseP25(closed)!.isSquelchOpen).toBe(false);
    });

    it('trims whitespace in name fields', () => {
        const padded = 'GLG,801,FM,0,, Sys , Grp , Chan ,1,0';
        const ev = ScannerDecoder.parseP25(padded)!;
        expect(ev.systemName).toBe('Sys');
        expect(ev.groupName).toBe('Grp');
        expect(ev.channelName).toBe('Chan');
    });

    it('returns null for a GLG line with fewer than 10 fields', () => {
        // 9 fields only.
        expect(ScannerDecoder.parseP25('GLG,801,FM,0,,Sys,Grp,Chan,1')).toBeNull();
    });

    it('returns null for an empty / whitespace tgid', () => {
        expect(ScannerDecoder.parseP25('GLG,,FM,0,,Sys,Grp,Chan,1,0')).toBeNull();
        expect(ScannerDecoder.parseP25('GLG,   ,FM,0,,Sys,Grp,Chan,1,0')).toBeNull();
    });

    it('returns null for non-GLG lines', () => {
        expect(ScannerDecoder.parseP25('EDW TG-321')).toBeNull();
        expect(ScannerDecoder.parseP25('XGLG,801,...')).toBeNull();
        expect(ScannerDecoder.parseP25('')).toBeNull();
    });
});
