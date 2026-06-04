import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { csvField, SentinelStore } from './SentinelStore';

// ─── CSV correctness (csvField) ───────────────────────────────────────────────
// csvField implements RFC-4180 quoting + spreadsheet formula-injection
// neutralisation. It is exported solely so this behaviour can be locked in.

describe('csvField (RFC-4180 + formula-injection)', () => {
    it('always wraps the value in double quotes', () => {
        expect(csvField('hello')).toBe('"hello"');
        expect(csvField('')).toBe('""');
    });

    it('renders null/undefined as an empty quoted field', () => {
        expect(csvField(null)).toBe('""');
        expect(csvField(undefined)).toBe('""');
    });

    it('stringifies numbers', () => {
        expect(csvField(801)).toBe('"801"');
        expect(csvField(0)).toBe('"0"');
    });

    it('escapes embedded double-quotes by doubling them', () => {
        expect(csvField('say "hi"')).toBe('"say ""hi"""');
    });

    it('preserves commas and newlines inside the quoted field', () => {
        // The surrounding quotes are what make commas/newlines safe in CSV.
        expect(csvField('a,b')).toBe('"a,b"');
        expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    });

    it('neutralises formula-trigger leading characters with a tab prefix', () => {
        // =, +, -, @ are spreadsheet formula starters; prefix a literal tab.
        expect(csvField('=SUM(A1)')).toBe('"\t=SUM(A1)"');
        expect(csvField('+1')).toBe('"\t+1"');
        expect(csvField('-1')).toBe('"\t-1"');
        expect(csvField('@cmd')).toBe('"\t@cmd"');
    });

    it('neutralises leading tab / carriage-return too', () => {
        expect(csvField('\tx')).toBe('"\t\tx"');
        expect(csvField('\rx')).toBe('"\t\rx"');
    });

    it('does NOT prefix when the trigger char is not first', () => {
        expect(csvField('a=b')).toBe('"a=b"');
        expect(csvField('1-2')).toBe('"1-2"');
    });
});

// ─── getLeaderboardRows prune logic ───────────────────────────────────────────

describe('SentinelStore.getLeaderboardRows prune', () => {
    let store: SentinelStore;
    const NOW = 1_700_000_000_000; // fixed wall clock for determinism

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        localStorage.clear();
        store = new SentinelStore();
    });

    afterEach(() => {
        store.stop();
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        localStorage.clear();
    });

    const MIN = 60_000;

    it('drops an entry whose timestamps are ALL older than 60 min', () => {
        // Two stale timestamps (90 and 70 min ago) -> entry excluded entirely.
        store.tgHits.set('801', [NOW - 90 * MIN, NOW - 70 * MIN]);
        const rows = store.getLeaderboardRows();
        expect(rows.find(r => r.id === '801')).toBeUndefined();
    });

    it('computes h5 / h60 correctly for a mix of fresh and stale timestamps', () => {
        store.tgHits.set('801', [
            NOW - 90 * MIN, // stale (>60m) - trimmed, not counted
            NOW - 30 * MIN, // within 60m, not within 5m
            NOW - 10 * MIN, // within 60m, not within 5m
            NOW - 2 * MIN,  // within 5m
            NOW - 1 * MIN,  // within 5m
        ]);
        const rows = store.getLeaderboardRows();
        const row = rows.find(r => r.id === '801');
        expect(row).toBeDefined();
        expect(row!.h60).toBe(4); // the four non-stale entries
        expect(row!.h5).toBe(2);  // the two within 5 min
    });

    it('resolves name/agency from AgencyDB for known ids and falls back for unknown', () => {
        store.tgHits.set('801', [NOW - 1 * MIN]);      // known -> FHP
        store.tgHits.set('999999', [NOW - 1 * MIN]);   // unknown -> UNK
        const rows = store.getLeaderboardRows();
        const known = rows.find(r => r.id === '801')!;
        const unknown = rows.find(r => r.id === '999999')!;
        expect(known.agency).toBe('FHP');
        expect(unknown.agency).toBe('UNK');
        expect(unknown.name).toBe('Unknown ID');
    });

    it('trims the stale prefix in place so subsequent reads stay consistent', () => {
        store.tgHits.set('801', [NOW - 90 * MIN, NOW - 1 * MIN]);
        store.getLeaderboardRows();
        // The expired leading timestamp is spliced out of the live array.
        expect(store.tgHits.get('801')).toEqual([NOW - 1 * MIN]);
    });

    it('sorts rows by h5 desc then h60 desc and caps at 20', () => {
        // id 'A' has more 5-min hits; id 'B' more 60-min but fewer 5-min.
        store.tgHits.set('A', [NOW - 1 * MIN, NOW - 2 * MIN]);            // h5=2 h60=2
        store.tgHits.set('B', [NOW - 10 * MIN, NOW - 20 * MIN, NOW - 1 * MIN]); // h5=1 h60=3
        const rows = store.getLeaderboardRows();
        expect(rows[0].id).toBe('A');
        expect(rows[1].id).toBe('B');
        expect(rows.length).toBeLessThanOrEqual(20);
    });
});
