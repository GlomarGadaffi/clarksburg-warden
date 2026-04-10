import { useEffect, useState } from 'react';
import { Serial } from '../core/SerialMonitor';
import type { EDACSEvent, P25Event, PatchEvent, SiteEvent } from '../types';
import { DB, agClass } from '../core/AgencyDB';
import './EDACSDashboard.css'; 
import './UnifiedDashboard.css';

export default function UnifiedDashboard() {
    const [site, setSite] = useState<string>('AWAITING C-CH');
    const [patches, setPatches] = useState<Record<string, { members: string[], lastSeen: number, hits: number }>>({});
    
    // P25 State
    const [p25Cards, setP25Cards] = useState<Record<string, { name: string, agency: string, hits: number, lastSeen: number, isNew: boolean }>>({});
    const [holdingTG, setHoldingTG] = useState<string | null>(null);
    const [lcd, setLcd] = useState({ state: 'SCANNING', tgid: '---', name: 'System Standby', agency: '--' });

    useEffect(() => {
        const handleEDACS = (e: EDACSEvent) => {
            if (e.type === 'SITE') setSite((e as SiteEvent).siteId);
            
            if (e.type === 'PATCH') {
                const pe = e as PatchEvent;
                setPatches(prev => {
                    const existing = prev[pe.patchId] || { members: [], hits: 0, lastSeen: e.timestamp };
                    const members = existing.members.includes(pe.memberId) ? existing.members : [...existing.members, pe.memberId];
                    return { ...prev, [pe.patchId]: { members, hits: existing.hits + 1, lastSeen: e.timestamp } };
                });
            }
        };

        const handleP25 = (e: P25Event) => {
            if (holdingTG && holdingTG !== e.tgid) return; 
            if (holdingTG && holdingTG === e.tgid) {
                setLcd(prev => ({ ...prev, state: 'AUDIO HOLD', tgid: e.tgid, name: DB[e.tgid]?.n || e.channelName, agency: DB[e.tgid]?.a || 'UNK' }));
            } else {
                setLcd({ state: '>>> SKIP', tgid: e.tgid, name: DB[e.tgid]?.n || e.channelName, agency: DB[e.tgid]?.a || 'UNK' });
                Serial.queueCmd("KEY,S,P");
            }

            setP25Cards(prev => {
                const existing = prev[e.tgid] || { 
                    name: DB[e.tgid]?.n || e.channelName || 'Unknown TG', 
                    agency: DB[e.tgid]?.a || 'P25', 
                    hits: 0, isNew: !DB[e.tgid] 
                };
                return {
                    ...prev,
                    [e.tgid]: { ...existing, hits: existing.hits + 1, lastSeen: e.timestamp }
                };
            });
        };

        Serial.onEDACS(handleEDACS);
        Serial.onP25(handleP25);

        const intv = setInterval(() => {
            const now = Date.now();
            setPatches(prev => {
                const copy = { ...prev };
                let changed = false;
                for (const pid in copy) {
                    if (now - copy[pid].lastSeen > 30000) { delete copy[pid]; changed = true; }
                }
                return changed ? copy : prev;
            });

            setP25Cards(prev => {
                const copy = { ...prev };
                let changed = false;
                for (const tgid in copy) {
                    if (now - copy[tgid].lastSeen > 300000 && holdingTG !== tgid) { 
                        delete copy[tgid]; changed = true; 
                    }
                }
                return changed ? copy : prev;
            });
            
            setLcd(prev => {
                if (prev.state === '>>> SKIP' && !holdingTG) {
                    return { state: 'SCANNING', tgid: '---', name: 'System Standby', agency: '--'};
                }
                return prev;
            });
        }, 1000);

        return () => clearInterval(intv);
    }, [holdingTG]);

    const toggleHold = (tgid: string) => {
        if (holdingTG === tgid) {
            setHoldingTG(null);
            Serial.queueCmd("KEY,S,P");
            setLcd({ state: 'SCANNING', tgid: '---', name: 'System Standby', agency: '--' });
        } else {
            setHoldingTG(tgid);
            Serial.queueCmd("KEY,H,P");
        }
    };

    return (
        <div className="unified-dashboard">
            <div className="edacs-matrix-panel">
                <div className="panel-header slers-accent">
                    <span className="panel-title slers-title-color">SLERS Patch Matrix</span>
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

            <div className="p25-panel">
                <div className="panel-header p25-accent">
                    <span className="panel-title p25-title-color">Alachua County P25</span>
                    <span className="panel-badge">{Object.keys(p25Cards).length} Active</span>
                </div>
                <div className="p25-body">
                    <div className="lcd">
                        <span className={`lcd-state ${lcd.state.includes('HOLD') ? 'holding' : 'scanning'}`}>{lcd.state}</span>
                        <div className="lcd-tgid">{lcd.tgid}</div>
                        <div className="lcd-name">{lcd.name}</div>
                        <div className="lcd-agency">{lcd.agency}</div>
                    </div>
                    <div className="tac-grid-header">
                        <span>Tactical Grid — Click to Hold</span>
                    </div>
                    <div className="tac-grid">
                        {Object.entries(p25Cards).sort((a,b) => b[1].lastSeen - a[1].lastSeen).map(([tgid, c]) => (
                            <div 
                                key={tgid} 
                                className={`tg-card active ${agClass(c.agency.substring(0,4))} ${holdingTG === tgid ? 'holding' : ''} ${c.isNew ? 'discovery' : ''}`}
                                onClick={() => toggleHold(tgid)}
                            >
                                <div className="tg-head">
                                    <div className="tg-head-left">
                                        {c.isNew && <span className="badge-new">NEW</span>}
                                        {holdingTG === tgid && <span className="badge-hold">HOLD</span>}
                                        <span>{tgid}</span>
                                    </div>
                                    <span className="badge-hits">{c.hits} HITS</span>
                                </div>
                                <div className="tg-body">
                                    <div className="tg-name">{c.name}</div>
                                    <div className="tg-meta">
                                        <span>{c.agency}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
