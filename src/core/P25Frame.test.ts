import { describe, it, expect } from 'vitest';
import { ScannerDecoder } from './Decoder';
import type { GrantEvent, SiteEvent } from '../types';

// Fixtures are REAL lines captured from a BCD325P2 monitoring the Alachua/
// Gainesville SLERS-P25 system (C-CH Output: Extend), preserved verbatim.

describe('ScannerDecoder.parseP25Frame', () => {
    it('parses a single CNM group voice grant (hex TG/CH, freq VC)', () => {
        const ev = ScannerDecoder.parseP25Frame(
            'P25,02000121086301C908099C2F,CNM TG-0863 CH-121 VC-08528125'
        );
        expect(ev).toHaveLength(1);
        const g = ev[0] as GrantEvent;
        expect(g.type).toBe('GRANT');
        expect(g.source).toBe('P25');
        expect(g.grantType).toBe('TG');
        expect(g.talkgroupId).toBe('2147');     // 0x0863  (ACSO A1)
        expect(g.logicalChannel).toBe('289');   // 0x121
        expect(g.voiceChannel).toBe('08528125');
        expect(g.frequency).toBe('852.8125 MHz');
    });

    it('parses TWO different CNM grants on one line', () => {
        const ev = ScannerDecoder.parseP25Frame(
            'P25,0200007B083D011B0C19CDBE,CNM TG-083D CH-07B VC-08517750,CNM TG-0C19 CH-11B VC-08527750'
        );
        const grants = ev.filter(e => e.type === 'GRANT') as GrantEvent[];
        expect(grants).toHaveLength(2);
        expect(grants[0].talkgroupId).toBe('2109');   // 0x083D
        expect(grants[0].frequency).toBe('851.7750 MHz');
        expect(grants[1].talkgroupId).toBe('3097');   // 0x0C19
        expect(grants[1].frequency).toBe('852.7750 MHz');
    });

    it('de-duplicates an identical doubled CNM grant', () => {
        const ev = ScannerDecoder.parseP25Frame(
            'P25,0200011B0C19011B0C19BE64,CNM TG-0C19 CH-11B VC-08527750,CNM TG-0C19 CH-11B VC-08527750'
        );
        const grants = ev.filter(e => e.type === 'GRANT') as GrantEvent[];
        expect(grants).toHaveLength(1);
        expect(grants[0].talkgroupId).toBe('3097');
    });

    it('parses SID/SIT system identity', () => {
        const ev = ScannerDecoder.parseP25Frame('P25,3A000034D90102015D70C4C5,SID-04D9 SUB-01 SIT-02');
        const site = ev.find(e => e.type === 'SITE') as SiteEvent;
        expect(site).toBeDefined();
        expect(site.sysId).toBe('04D9');
        expect(site.site).toBe('02');
        expect(site.siteId).toBe('02');
    });

    it('parses a WACN frame', () => {
        const ev = ScannerDecoder.parseP25Frame('P25,3B0000BEE004D9015D700112,WACN-BEE00');
        const site = ev.find(e => e.type === 'SITE') as SiteEvent;
        expect(site).toBeDefined();
        expect(site.wacn).toBe('BEE00');
    });

    it('returns nothing for bare PN/UN sync frames', () => {
        expect(ScannerDecoder.parseP25Frame('P25,09900DC000000000000016CC,UN')).toHaveLength(0);
        expect(ScannerDecoder.parseP25Frame('P25,00100F000000000000164F7F,PN')).toHaveLength(0);
    });

    it('returns nothing for non-P25 lines', () => {
        expect(ScannerDecoder.parseP25Frame('GLG,2147,NFM,0,0,Simulcast,x,ACSO A1,1,0')).toHaveLength(0);
        expect(ScannerDecoder.parseP25Frame('EDW SIT-1A')).toHaveLength(0);
    });
});
