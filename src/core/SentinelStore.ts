import { Serial } from './SerialMonitor';
import type { EDACSEvent, PatchEvent, SiteEvent, GrantEvent, P25Event, RawLogEntry, LeaderboardEntry, SessionStats } from '../types';
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

export class SentinelStore {
    private version = 0;
    private listeners: Set<() => void> = new Set();
    
    // State
    public siteId: string = 'AWAITING C-CH';
    public patches: Map<string, PatchState> = new Map();
    public grants: GrantEvent[] = [];
    public p25Cards: Map<string, P25CardState> = new Map();
    public lcnMap: Map<string, string> = new Map(); // LCN Hex -> VC Hex
    
    // Analytics
    public tgHits: Map<string, number[]> = new Map(); // SLERS hits for leaderboard
    public rawLog: RawLogEntry[] = [];
    public stats: SessionStats = {
        sessionStart: Date.now(),
        patches: 0,
        grants: 0,
        p25Total: 0
    };
    
    // Persistent Hit Counters
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
            console.error("Failed to load persistence", e);
        }
    }

    private scheduleSave() {
        if (!this.saveTimeout) {
            this.saveTimeout = window.setTimeout(() => {
                localStorage.setItem('sentinel_slers', JSON.stringify(this.persistentSlers));
                localStorage.setItem('sentinel_p25', JSON.stringify(this.persistentP25));
                this.saveTimeout = null;
            }, 5000);
        }
    }

    private trackSlersHit(id: string) {
        // Ephemeral
        if (!this.tgHits.has(id)) {
            this.tgHits.set(id, []);
        }
        this.tgHits.get(id)!.push(Date.now());
        
        // Persistent
        this.persistentSlers[id] = (this.persistentSlers[id] || 0) + 1;
        this.scheduleSave();
    }

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
    }

    private handleEDACS = (e: EDACSEvent) => {
        if (e.type === 'SITE') {
            this.siteId = (e as SiteEvent).siteId;
            this.emitChange();
        }
        else if (e.type === 'PATCH') {
            const pe = e as PatchEvent;
            const existing = this.patches.get(pe.patchId);
            
            this.trackSlersHit(pe.patchId); // Count hit on the patch itself
            // Wait, legacy sentinel tracked the member ID
            const memDec = pe.memberId; // In legacy it parsed base 16, now Decoder already passed string.
            // Oh, Decoder.ts line 24 did `parseInt(memM[1], 16).toString()` for memberId. So it's correct.
            this.trackSlersHit(memDec);

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
        }
        else if (e.type === 'GRANT') {
            const ge = e as GrantEvent;
            const tgid = ge.talkgroupId || ge.unitId;
            if (tgid) this.trackSlersHit(tgid);
            
            // Populate Auto-Discovered LCN Map
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

        const existing = this.p25Cards.get(e.tgid);
        if (existing) {
            existing.hits++;
            existing.lastSeen = e.timestamp;
        } else {
            const hits = this.trackP25Hit(e.tgid);
            this.p25Cards.set(e.tgid, {
                name: DB[e.tgid]?.n || e.channelName || 'Unknown TG',
                agency: DB[e.tgid]?.a || 'P25',
                hits: 1, // session hits
                lastSeen: e.timestamp,
                isNew: hits === 1 && !DB[e.tgid]
            });
        }
        this.emitChange();
    }

    private handleRawLine = (line: string) => {
        this.rawLog.push({ line, timestamp: Date.now() });
        if (this.rawLog.length > 200) this.rawLog.shift();
        this.emitChange();
    }

    private tick = () => {
        const now = Date.now();

        // Prune patches (>30s), remove TX flash (>2s)
        for (const [id, p] of this.patches.entries()) {
            if (now - p.lastSeen > 30000) {
                this.patches.delete(id);
            } else if (p.isActive && now - p.lastSeen > 2000) {
                p.isActive = false;
            }
        }

        // Prune P25 Cards (>5m)
        for (const [id, c] of this.p25Cards.entries()) {
            if (now - c.lastSeen > 300000 && this.p25HoldingTG !== id) {
                this.p25Cards.delete(id);
            }
        }

        // Reset LCD state if skipping
        if (this.lcdState === '>>> SKIP' && !this.p25HoldingTG) {
            this.lcdState = 'SCANNING';
            this.lcdData = { tgid: '---', name: 'System Standby', agency: '--' };
        }

        // We emit change on every tick to update relative timestamps automatically across the UI
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

    public getLeaderboardRows(): LeaderboardEntry[] {
        const now = Date.now();
        const rows: LeaderboardEntry[] = [];
        
        for (const [tgid, timestamps] of this.tgHits.entries()) {
            // Prune > 60m
            const validIdx = timestamps.findIndex(t => now - t < 3600000);
            if (validIdx > 0) {
                timestamps.splice(0, validIdx);
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
        const rows = ["timestamp,tgid,name,agency,grantType,lcn,vc"];
        for (const g of this.grants) {
            const tgid = g.talkgroupId || g.unitId || 'UNK';
            const info = DB[tgid] || { n: 'Unknown', a: 'UNK' };
            rows.push(`${new Date(g.timestamp).toISOString()},${tgid},"${info.n}",${info.a},${g.grantType},${g.logicalChannel || ''},${g.voiceChannel || ''}`);
        }
        const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
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
