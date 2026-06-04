import PatchMatrix from '../components/PatchMatrix';
import Leaderboard from '../components/Leaderboard';
import { useSentinelState, useSentinelStore } from '../core/useSentinel';
import { agClass } from '../core/AgencyDB';
import { Radio } from 'lucide-react';
import './UnifiedDashboard.css';

export default function UnifiedDashboard() {
    const store = useSentinelStore();
    const { p25Cards, lcdState, lcdData, p25HoldingTG } = useSentinelState();

    const sortedCards = Array.from(p25Cards.entries()).sort((a, b) => b[1].lastSeen - a[1].lastSeen);

    return (
        <div className="unified-dashboard">
            <div className="unified-left-panel">
                <PatchMatrix />
                <Leaderboard />
            </div>

            <div className="p25-panel">
                <div className="panel-header p25-accent">
                    <span className="panel-title p25-title-color">
                        <Radio size={12} aria-hidden="true" />
                        Alachua County P25
                    </span>
                    <span className="panel-badge" aria-label={`${p25Cards.size} active talkgroups`}>
                        {p25Cards.size} Active
                    </span>
                </div>
                <div className="p25-body">
                    <div className="lcd" role="status" aria-label="Current scanner display">
                        <span
                            className={`lcd-state ${
                                lcdState.includes('HOLD') ? 'holding' :
                                lcdState === '>>> SKIP' ? 'skipping' :
                                'scanning'
                            }`}
                            aria-live="polite"
                        >
                            {lcdState}
                        </span>
                        <div className="lcd-tgid" aria-label={`Talkgroup ID ${lcdData.tgid || 'none'}`}>
                            {lcdData.tgid || <span className="lcd-placeholder">——</span>}
                        </div>
                        <div className="lcd-name">
                            {lcdData.name || <span className="lcd-placeholder">Awaiting control channel…</span>}
                        </div>
                        <div className="lcd-agency">{lcdData.agency}</div>
                    </div>

                    <div className="tac-grid-header">
                        <span>Tactical Grid</span>
                        <span className="tac-grid-hint">Click card to hold</span>
                    </div>

                    {sortedCards.length === 0 ? (
                        <div className="tac-grid-empty empty-state-panel">
                            <Radio size={28} className="empty-icon" aria-hidden="true" />
                            <strong>No active talkgroups</strong>
                            <span>P25 activity will appear here once the scanner locks onto a talkgroup.</span>
                        </div>
                    ) : (
                        <div className="tac-grid" role="list" aria-label="Active talkgroups">
                            {sortedCards.map(([tgid, c]) => {
                                const isHeld = p25HoldingTG === tgid;
                                return (
                                    <button
                                        key={tgid}
                                        role="listitem"
                                        className={`tg-card active ${agClass(c.agency.substring(0, 4))} ${isHeld ? 'holding' : ''} ${c.isNew ? 'discovery' : ''}`}
                                        onClick={() => store.toggleP25Hold(tgid)}
                                        aria-pressed={isHeld}
                                        aria-label={`Talkgroup ${tgid}${c.name ? ` — ${c.name}` : ''}${isHeld ? ', currently held' : ', click to hold'}`}
                                    >
                                        <div className="tg-head">
                                            <div className="tg-head-left">
                                                {c.isNew && <span className="badge-new" aria-label="New talkgroup">NEW</span>}
                                                {isHeld && <span className="badge-hold">HOLD</span>}
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
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
