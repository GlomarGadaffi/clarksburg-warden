import { Serial } from './SerialMonitor';
import type {
    EDACSEvent, PatchEvent, SiteEvent, GrantEvent, P25Event,
    RawLogEntry, LeaderboardEntry, SessionStats
} from '../types';
import { DB } from './AgencyDB';

export interface PatchState {
    members: string[];
    lastSeen: number;
    hits: number;
    isActive: boolean;
}

export interface P25CardState {
    name: string;
    agency: string;
    hits: number;
    lastSeen: number;
    isNew: boolean;
}

// ─── CSV helpers (RFC-4180 + formula-injection neutralisation) ────────────────

/**
 * Wraps a field in double-quotes and escapes embedded double-quotes per RFC-4180.
 * Also strips leading =, +, -, @ characters that spreadsheet apps interpret as
 * formula starters (CSV injection / DDE injection mitigation).
 */
function csvField(value: string | number | undefined | null): string {
    const str = value == null ? '' : String(value);
    // Neutralise spreadsheet formula injection: prefix with a tab if the first
    // character is a formula-trigger character.
    const safe = /^[=+\-@\t\r]/.test(str) ? `\t${str}` : str;
    // RFC-4180: always quote and escape internal double-quotes.
    return `"${safe.replace(/"/g, '""')}"`;
}

// ─────────────────────────────────────────────────────────────────────────────

export class SentinelStore {
    private version = 0;
    private listeners: Set<() => void> = new Set();

    // State
    public siteId: string = 'AWAITING C-CH';
    public patches: Map<string, PatchState> = new Map();
    public grants: GrantEvent[] = [];
    public p25Cards: Map<string, P25CardState> = new Map();
    public lcnMap: Map<string, string> = new Map(); // LCN Dec -> VC Dec

    // Analytics
    public tgHits: Map<string, number[]> = new Map(); // SLERS hits for leaderboard
    public rawLog: RawLogEntry[] = [];
    public stats: SessionStats = {
        sessionStart: Date.now(),
        patches: 0,
        grants: 0,
        p25Total: 0
    };

    // Persistent Hit Counters (localStorage: 'sentinel_slers', 'sentinel_p25')
    public persistentSlers: Record<string, number> = {};
    public persistentP25: Record<string, number> = {};

    // Timers
    private tickInt: number | null = null;
    private saveTimeout: number | null = null;

    // Unsubscriptions
    private unsubs: (() => void)[] = [];

    // P25 Holding
    public p25HoldingTG: string | null = null;
    public lcdState: 'SCANNING' | '>>> SKIP' | 'AUDIO HOLD' = 'SCANNING';
    public lcdData = { tgid: '---', name: 'System Standby', agency: '--' };

    constructor() {
        this.loadPersistentData();
        this.start();
    }

    public subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public getSnapshot = () => {
        return this.version;
    }

    private emitChange() {
        this.version++;
        this.listeners.forEach(l => l());
    }

    private loadPersistentData() {
        try {
            const s = localStorage.getItem('sentinel_slers');
            const p = localStorage.getItem('sentinel_p25');
            if (s) this.persistentSlers = JSON.parse(s);
            if (p) this.persistentP25 = JSON.parse(p);

            // Recalculate p25 total hits from persistence
            this.stats.p25Total = Object.values(this.persistentP25).reduce((a, b) => a + b, 0);
        } catch (e) {
            // Corrupted storage — reset gracefully rather than crashing.
            console.error("Failed to load persistence; resetting:", e);
            this.persistentSlers = {};
            this.persistentP25 = {};
        }
    }

    private scheduleSave() {
        if (!this.saveTimeout) {
            this.saveTimeout = window.setTimeout(() => {
                try {
                    localStorage.setItem('sentinel_slers', JSON.stringify(this.persistentSlers));
                    localStorage.setItem('sentinel_p25', JSON.stringify(this.persistentP25));
                } catch (e) {
                    // QuotaExceededError or SecurityError — log but don't crash.
                    console.warn("localStorage save failed:", e);
                }
                this.saveTimeout = null;
            }, 5000);
        }
    }

    private trackSlersHit(id: string) {
        // Ephemeral — timestamp array for rolling-window leaderboard
        if (!this.tgHits.has(id)) {
            this.tgHits.set(id, []);
        }
        this.tgHits.get(id)!.push(Date.now());

        // Persistent all-time counter
        this.persistentSlers[id] = (this.persistentSlers[id] || 0) + 1;
        this.scheduleSave();
    }

    /**
     * Increment the persistent P25 counter for a talkgroup and keep stats in
     * sync.  Must be called on EVERY P25 hit (not just the first sighting).
     */
    private trackP25Hit(id: string): number {
        this.persistentP25[id] = (this.persistentP25[id] || 0) + 1;
        this.stats.p25Total++;
        this.scheduleSave();
        return this.persistentP25[id];
    }

    public start() {
        this.unsubs.push(Serial.onEDACS(this.handleEDACS));
        this.unsubs.push(Serial.onP25(this.handleP25));
        this.unsubs.push(Serial.onRawLine(this.handleRawLine));

        this.tickInt = window.setInterval(this.tick, 1000);
    }

    public stop() {
        this.unsubs.forEach(fn => fn());
        this.unsubs = [];
        if (this.tickInt) clearInterval(this.tickInt);
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
            // Flush immediately on stop so no data is lost.
            try {
                localStorage.setItem('sentinel_slers', JSON.stringify(this.persistentSlers));
                localStorage.setItem('sentinel_p25', JSON.stringify(this.persistentP25));
            } catch { /* best effort */ }
        }
    }

    private handleEDACS = (e: EDACSEvent) => {
        if (e.type === 'SITE') {
            this.siteId = (e as SiteEvent).siteId;
            this.emitChange();
        } else if (e.type === 'PATCH') {
            const pe = e as PatchEvent;
            const existing = this.patches.get(pe.patchId);

            // Track hits on both the patch ID and the member ID (decimal string).
            // Decoder already converts memberId from hex → decimal string.
            this.trackSlersHit(pe.patchId);
            this.trackSlersHit(pe.memberId);

            if (existing) {
                if (!existing.members.includes(pe.memberId)) existing.members.push(pe.memberId);
                existing.hits++;
                existing.lastSeen = e.timestamp;
                existing.isActive = true;
            } else {
                this.patches.set(pe.patchId, {
                    members: [pe.memberId],
                    hits: 1,
                    lastSeen: e.timestamp,
                    isActive: true
                });
                this.stats.patches++;
            }
            this.emitChange();
        } else if (e.type === 'GRANT') {
            const ge = e as GrantEvent;
            const tgid = ge.talkgroupId || ge.unitId;
            if (tgid) this.trackSlersHit(tgid);

            // Populate auto-discovered LCN map (decimal keys)
            if (ge.logicalChannel && ge.voiceChannel) {
                this.lcnMap.set(ge.logicalChannel, ge.voiceChannel);
            }

            this.grants.unshift(ge);
            if (this.grants.length > 200) this.grants.pop();
            this.stats.grants++;
            this.emitChange();
        }
    }

    private handleP25 = (e: P25Event) => {
        if (this.p25HoldingTG && this.p25HoldingTG !== e.tgid) return;

        if (this.p25HoldingTG && this.p25HoldingTG === e.tgid) {
            this.lcdState = 'AUDIO HOLD';
            this.lcdData = { tgid: e.tgid, name: DB[e.tgid]?.n || e.channelName, agency: DB[e.tgid]?.a || 'UNK' };
        } else {
            this.lcdState = '>>> SKIP';
            this.lcdData = { tgid: e.tgid, name: DB[e.tgid]?.n || e.channelName, agency: DB[e.tgid]?.a || 'UNK' };
            Serial.queueCmd("KEY,S,P");
        }

        // BUG FIX #1: trackP25Hit must be called on EVERY hit, not only when a
        // new card is created.  Previously, persistentP25 and stats.p25Total only
        // grew the first time a TGID was seen; subsequent hits to an existing card
        // only incremented the ephemeral `existing.hits` counter.
        const totalHits = this.trackP25Hit(e.tgid);

        const existing = this.p25Cards.get(e.tgid);
        if (existing) {
            existing.hits++;
            existing.lastSeen = e.timestamp;
        } else {
            this.p25Cards.set(e.tgid, {
                name: DB[e.tgid]?.n || e.channelName || 'Unknown TG',
                agency: DB[e.tgid]?.a || 'P25',
                hits: 1,
                lastSeen: e.timestamp,
                // isNew = true only on literal first-ever sighting (persistent count == 1
                // AND not in the known DB).
                isNew: totalHits === 1 && !DB[e.tgid]
            });
        }
        this.emitChange();
    }

    private handleRawLine = (line: string) => {
        this.rawLog.push({ line, timestamp: Date.now() });
        if (this.rawLog.length > 200) this.rawLog.shift();
        // Raw log updates don't need a synchronous re-render on every line.
        // emitChange is still called so the UI can poll, but the tick already
        // fires every second for timestamp refreshes.
        this.emitChange();
    }

    private tick = () => {
        const now = Date.now();

        // Prune patches (>30 s), remove TX flash (>2 s)
        for (const [id, p] of this.patches.entries()) {
            if (now - p.lastSeen > 30000) {
                this.patches.delete(id);
            } else if (p.isActive && now - p.lastSeen > 2000) {
                p.isActive = false;
            }
        }

        // Prune P25 cards (>5 min, but never prune held TG)
        for (const [id, c] of this.p25Cards.entries()) {
            if (now - c.lastSeen > 300000 && this.p25HoldingTG !== id) {
                this.p25Cards.delete(id);
            }
        }

        // BUG FIX #2 (partial): prune fully-expired tgHits entries from memory so
        // the Map doesn't grow unbounded.  Entries with no timestamps in the last
        // 60 min are removed from the Map entirely.  This is intentionally done in
        // the tick (once per second) rather than in getLeaderboardRows so the Map
        // stays clean regardless of whether the leaderboard panel is visible.
        for (const [id, timestamps] of this.tgHits.entries()) {
            const firstValidIdx = timestamps.findIndex(t => now - t < 3600000);
            if (firstValidIdx === -1) {
                // All timestamps are expired — remove entry entirely to prevent unbounded growth.
                this.tgHits.delete(id);
            } else if (firstValidIdx > 0) {
                // Trim the stale prefix.
                timestamps.splice(0, firstValidIdx);
            }
        }

        // Reset LCD state if we were skipping and no hold is active
        if (this.lcdState === '>>> SKIP' && !this.p25HoldingTG) {
            this.lcdState = 'SCANNING';
            this.lcdData = { tgid: '---', name: 'System Standby', agency: '--' };
        }

        // Emit once per second so relative timestamps refresh across the UI.
        this.emitChange();
    }

    public toggleP25Hold(tgid: string) {
        if (this.p25HoldingTG === tgid) {
            this.p25HoldingTG = null;
            Serial.queueCmd("KEY,S,P");
            this.lcdState = 'SCANNING';
            this.lcdData = { tgid: '---', name: 'System Standby', agency: '--' };
        } else {
            this.p25HoldingTG = tgid;
            Serial.queueCmd("KEY,H,P");
            const card = this.p25Cards.get(tgid);
            if (card) {
                this.lcdState = 'AUDIO HOLD';
                this.lcdData = { tgid, name: card.name, agency: card.agency };
            }
        }
        this.emitChange();
    }

    public getLeaderboardRows = (): LeaderboardEntry[] => {
        const now = Date.now();
        const rows: LeaderboardEntry[] = [];

        for (const [tgid, timestamps] of this.tgHits.entries()) {
            // BUG FIX #2: prune stale timestamps.
            // findIndex returns -1 when NO timestamps are within 60 min (all expired).
            // The previous guard `validIdx > 0` skipped the splice when validIdx was -1,
            // leaving stale data and inflating h60 forever.
            const firstValidIdx = timestamps.findIndex(t => now - t < 3600000);

            if (firstValidIdx === -1) {
                // All timestamps older than 60 min — skip this entry entirely.
                // (The tick() above will delete it from the Map next second.)
                continue;
            }
            if (firstValidIdx > 0) {
                // Trim expired prefix.
                timestamps.splice(0, firstValidIdx);
            }

            const h60 = timestamps.length;
            if (h60 > 0) {
                const h5 = timestamps.filter(t => now - t < 300000).length;
                const info = DB[tgid] || { a: 'UNK', n: 'Unknown ID' };
                rows.push({ id: tgid, name: info.n, agency: info.a, h5, h60 });
            }
        }

        return rows.sort((a, b) => b.h5 - a.h5 || b.h60 - a.h60).slice(0, 20);
    }

    public wipeDB() {
        // Note: confirm() is a blocking browser dialog; flagged for UI layer to
        // replace with a non-blocking modal.  Left in place to avoid breaking the
        // public API that callers may rely on, but the UI agent should move this
        // dialog out of the store.
        if (confirm("Clear all persistent hit history?")) {
            localStorage.removeItem('sentinel_slers');
            localStorage.removeItem('sentinel_p25');
            this.persistentSlers = {};
            this.persistentP25 = {};
            this.stats.p25Total = 0;
            this.emitChange();
        }
    }

    public exportJSON() {
        const data = {
            stats: this.stats,
            patches: Array.from(this.patches.entries()),
            leaderboard: this.getLeaderboardRows(),
            grants: this.grants,
            persistentSlers: this.persistentSlers,
            persistentP25: this.persistentP25
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        this.downloadBlob(blob, `bearsentinel_export_${Date.now()}.json`);
    }

    public exportCSV() {
        // BUG FIX #4: RFC-4180 quoting + formula-injection neutralisation.
        // Previously fields were interpolated unescaped; a name containing a comma,
        // double-quote, or newline would corrupt the row, and a leading =, +, -, @
        // would be treated as a formula by spreadsheet applications.
        const header = [
            csvField("timestamp"),
            csvField("tgid"),
            csvField("name"),
            csvField("agency"),
            csvField("grantType"),
            csvField("lcn"),
            csvField("vc")
        ].join(",");

        const dataRows = this.grants.map(g => {
            const tgid = g.talkgroupId || g.unitId || 'UNK';
            const info = DB[tgid] || { n: 'Unknown', a: 'UNK' };
            return [
                csvField(new Date(g.timestamp).toISOString()),
                csvField(tgid),
                csvField(info.n),
                csvField(info.a),
                csvField(g.grantType),
                csvField(g.logicalChannel || ''),
                csvField(g.voiceChannel || '')
            ].join(",");
        });

        const blob = new Blob([[header, ...dataRows].join("\r\n")], { type: 'text/csv' });
        this.downloadBlob(blob, `bearsentinel_grants_${Date.now()}.csv`);
    }

    private downloadBlob(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
