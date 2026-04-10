import PatchMatrix from '../components/PatchMatrix';
import Leaderboard from '../components/Leaderboard';
import { useSentinelState, useSentinelStore } from '../core/useSentinel';
import { agClass } from '../core/AgencyDB';
import './UnifiedDashboard.css';

export default function UnifiedDashboard() {
    const store = useSentinelStore();
    const { p25Cards, lcdState, lcdData, p25HoldingTG } = useSentinelState();

    return (
        <div className="unified-dashboard">
            <div className="unified-left-panel">
                <PatchMatrix />
                <Leaderboard />
            </div>

            <div className="p25-panel">
                <div className="panel-header p25-accent">
                    <span className="panel-title p25-title-color">Alachua County P25</span>
                    <span className="panel-badge">{p25Cards.size} Active</span>
                </div>
                <div className="p25-body">
                    <div className="lcd">
                        <span className={`lcd-state ${lcdState.includes('HOLD') ? 'holding' : (lcdState === '>>> SKIP' ? 'skipping' : 'scanning')}`}>{lcdState}</span>
                        <div className="lcd-tgid">{lcdData.tgid}</div>
                        <div className="lcd-name">{lcdData.name}</div>
                        <div className="lcd-agency">{lcdData.agency}</div>
                    </div>
                    <div className="tac-grid-header">
                        <span>Tactical Grid — Click to Hold</span>
                    </div>
                    <div className="tac-grid">
                        {Array.from(p25Cards.entries()).sort((a,b) => b[1].lastSeen - a[1].lastSeen).map(([tgid, c]) => (
                            <div 
                                key={tgid} 
                                className={`tg-card active ${agClass(c.agency.substring(0,4))} ${p25HoldingTG === tgid ? 'holding' : ''} ${c.isNew ? 'discovery' : ''}`}
                                onClick={() => store.toggleP25Hold(tgid)}
                            >
                                <div className="tg-head">
                                    <div className="tg-head-left">
                                        {c.isNew && <span className="badge-new">NEW</span>}
                                        {p25HoldingTG === tgid && <span className="badge-hold">HOLD</span>}
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
