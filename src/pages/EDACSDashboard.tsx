import { useEffect, useState } from 'react';
import { Serial } from '../core/SerialMonitor';
import type { EDACSEvent, GrantEvent, PatchEvent, SiteEvent } from '../types';
import { DB, agClass } from '../core/AgencyDB';
import { Radio, Activity } from 'lucide-react';
import './EDACSDashboard.css';

export default function EDACSDashboard() {
    const [site, setSite] = useState<string>('AWAITING C-CH');
    const [grants, setGrants] = useState<GrantEvent[]>([]);
    const [patches, setPatches] = useState<Record<string, { members: string[], lastSeen: number, hits: number }>>({});

    useEffect(() => {
        const handleEvent = (e: EDACSEvent) => {
            if (e.type === 'SITE') setSite((e as SiteEvent).siteId);
            
            if (e.type === 'PATCH') {
                const pe = e as PatchEvent;
                setPatches(prev => {
                    const existing = prev[pe.patchId] || { members: [], hits: 0, lastSeen: e.timestamp };
                    const members = existing.members.includes(pe.memberId) 
                        ? existing.members 
                        : [...existing.members, pe.memberId];
                    return {
                        ...prev,
                        [pe.patchId]: { members, hits: existing.hits + 1, lastSeen: e.timestamp }
                    };
                });
            }

            if (e.type === 'GRANT') {
                setGrants(prev => [e as GrantEvent, ...prev].slice(0, 50));
            }
        };

        Serial.onEDACS(handleEvent);

        const intv = setInterval(() => {
            const now = Date.now();
            setPatches(prev => {
                const copy = { ...prev };
                let changed = false;
                for (const pid in copy) {
                    if (now - copy[pid].lastSeen > 30000) {
                        delete copy[pid];
                        changed = true;
                    }
                }
                return changed ? copy : prev;
            });
        }, 1000);

        return () => clearInterval(intv);
    }, []);

    return (
        <div className="edacs-dashboard">
            <div className="edacs-feed-panel">
                <div className="panel-header slers-accent">
                    <span className="panel-title slers-title-color"><Activity size={12}/> Live Call Feed</span>
                    <span className="panel-badge">{grants.length} calls</span>
                </div>
                <div className="feed-list">
                    {grants.length === 0 && <div className="empty-state">Awaiting Voice Channel Grants...</div>}
                    {grants.map((g, i) => {
                        const tgId = g.talkgroupId || g.unitId || 'UNK';
                        const info = DB[tgId] || { n: 'Unknown Target', a: 'UNK' };
                        return (
                            <div key={i} className={`feed-item card-enter ${agClass(info.a)}`}>
                                <div className="feed-item-header">
                                    <span className="feed-tgid">{tgId}</span>
                                    <span className="feed-meta">LCN {g.logicalChannel || '--'} • VC {g.voiceChannel || '--'}</span>
                                </div>
                                <div className="feed-item-name">{info.n}</div>
                                <div className="feed-item-footer">{info.a}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="edacs-matrix-panel">
                <div className="panel-header slers-accent">
                    <span className="panel-title slers-title-color"><Radio size={12}/> Patch Matrix (Active)</span>
                    <span className="panel-badge">SITE: {site}</span>
                </div>
                <div className="patch-grid">
                    {Object.keys(patches).length === 0 && <div className="empty-state">No active patches detected</div>}
                    {Object.entries(patches).map(([pid, p]) => (
                        <div key={pid} className="patch-card">
                            <div className="patch-card-head">
                                <span className="patch-id-label">PATCH {pid}</span>
                                <span className="patch-hits">{p.hits} HITS</span>
                            </div>
                            <div className="patch-members">
                                {p.members.map(mid => {
                                    const info = DB[mid] || { n: 'Unknown ID', a: 'UNK' };
                                    return (
                                        <div key={mid} className={`member-row ${agClass(info.a)}`}>
                                            <span className="member-id">{mid}</span>
                                            <span className="member-name">{info.n}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
