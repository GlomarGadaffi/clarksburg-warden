import { describe, it, expect, afterEach } from 'vitest';
import { Serial } from './SerialMonitor';
import type { EDACSEvent, P25Event } from '../types';

// These tests exercise the line-routing logic of the Serial singleton by feeding
// synthetic lines through the public `ingest()` path (the same entry point real
// hardware bytes use) and observing which listener fires.

describe('SerialMonitor.route', () => {
    const unsubs: (() => void)[] = [];
    afterEach(() => {
        unsubs.forEach(fn => fn());
        unsubs.length = 0;
    });

    it('routes a GLG response to the P25 parser even when its channel field contains "CH-"', () => {
        // Regression: a GLG line whose channel-name field contains "CH-" was
        // misrouted to the EDACS branch (loose /TG-|CH-|LCN-|VC-/ match) and
        // silently dropped, so P25 cards never appeared in Demo/live mode.
        const p25: P25Event[] = [];
        const edacs: EDACSEvent[] = [];
        unsubs.push(Serial.onP25(e => p25.push(e)));
        unsubs.push(Serial.onEDACS(e => edacs.push(e)));

        Serial.ingest('GLG,12301,FM,0,0,ACSO-P25,Law Dispatch,CH-123,1,0,293\r\n');

        expect(p25).toHaveLength(1);
        expect(p25[0].tgid).toBe('12301');
        expect(p25[0].channelName).toBe('CH-123');
        expect(p25[0].isSquelchOpen).toBe(true);
        expect(edacs).toHaveLength(0);
    });

    it('routes an EDACS grant line to the EDACS parser', () => {
        const p25: P25Event[] = [];
        const edacs: EDACSEvent[] = [];
        unsubs.push(Serial.onP25(e => p25.push(e)));
        unsubs.push(Serial.onEDACS(e => edacs.push(e)));

        // TG-321 (hex) → decimal "801"
        Serial.ingest('EDW CNM TG-321 LCN-5 VC-12\r\n');

        expect(edacs).toHaveLength(1);
        expect(edacs[0].type).toBe('GRANT');
        expect(p25).toHaveLength(0);
    });

    it('splits multi-line chunks on CRLF and routes each line', () => {
        const p25: P25Event[] = [];
        unsubs.push(Serial.onP25(e => p25.push(e)));

        Serial.ingest(
            'GLG,2057,FM,0,0,GPD-P25,Tac 3,CH-100,1,0,293\r\n' +
            'GLG,12401,FM,0,0,ACSO-P25,Fire Ops,CH-101,0,0,293\r\n'
        );

        expect(p25).toHaveLength(2);
        expect(p25.map(e => e.tgid)).toEqual(['2057', '12401']);
    });
});
