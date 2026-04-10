import { useSentinelState } from '../core/useSentinel';
import { agClass } from '../core/AgencyDB';
import './Leaderboard.css';

export default function Leaderboard() {
    const { getLeaderboardRows } = useSentinelState();
    const rows = getLeaderboardRows();

    return (
        <div className="tally-section">
            <div className="tally-head">
                <span>Talkgroup Leaderboard</span>
                <div className="tally-cols"><span>5m</span><span>60m</span></div>
            </div>
            <div className="tally-list">
                {rows.length === 0 && <div className="tally-empty">No hits in the last 60 minutes</div>}
                {rows.map(r => (
                    <div key={r.id} className="tally-row">
                        <div className="tally-label">
                            <div className={`tally-pip ${agClass(r.agency)}`}></div>
                            <span className="tally-id">{r.id}</span>
                            <span className="tally-name">{r.name}</span>
                        </div>
                        <div className="tally-counts">
                            <span>{r.h5}</span>
                            <span>{r.h60}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
