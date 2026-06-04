import { useSentinelState, useNow } from '../core/useSentinel';
import { DB, agClass } from '../core/AgencyDB';
import { Radio } from 'lucide-react';
import './PatchMatrix.css';

export default function PatchMatrix() {
    const { patches, siteId, persistentSlers } = useSentinelState();
    const now = useNow();

    const formatAge = (diffMs: number) => {
        if (diffMs < 60000) return `${Math.floor(diffMs/1000)}s ago`;
        return `${Math.floor(diffMs/60000)}m ago`;
    };

    return (
        <div className="edacs-matrix-panel">
            <div className="panel-header slers-accent">
                <span className="panel-title slers-title-color">
                    <Radio size={12} aria-hidden="true" />
                    Patch Matrix (Active)
                </span>
                <span className="panel-badge">SITE: {siteId}</span>
            </div>
            <div className="patch-grid">
                {patches.size === 0 && (
                    <div className="patch-empty">
                        <Radio size={28} style={{ opacity: 0.25, marginBottom: 4 }} aria-hidden="true" />
                        <strong>Awaiting control channel…</strong>
                        <span className="patch-empty-hint">Enable "C-CH Output" in Scanner Settings</span>
                    </div>
                )}

                {Array.from(patches.entries()).map(([pid, p]) => {
                    const diff = now - p.lastSeen;
                    return (
                        <div key={pid} className={`patch-card ${p.isActive ? 'tx' : ''}`}>
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
                                    );
                                })}
                            </div>
                            <div className="patch-footer">
                                <span>ALL-TIME: <b>{persistentSlers[pid] || 0}</b></span>
                                <span className="patch-age">{formatAge(diff)}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
