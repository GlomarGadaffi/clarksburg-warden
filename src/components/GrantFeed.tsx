import { useEffect, useRef, useState } from 'react';
import { useSentinelState, useNow } from '../core/useSentinel';
import { DB, agClass } from '../core/AgencyDB';
import { Activity } from 'lucide-react';
import './GrantFeed.css';

export default function GrantFeed() {
    const { grants } = useSentinelState();
    const feedRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);

    useEffect(() => {
        const el = feedRef.current;
        if (!el) return;

        const handleScroll = () => {
            const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
            setAutoScroll(isAtBottom);
        };

        el.addEventListener('scroll', handleScroll);
        return () => el.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        if (autoScroll && feedRef.current) {
            feedRef.current.scrollTop = feedRef.current.scrollHeight;
        }
    }, [grants, autoScroll]);

    const scrollToBottom = () => {
        if (feedRef.current) {
            feedRef.current.scrollTop = feedRef.current.scrollHeight;
            setAutoScroll(true);
        }
    };

    const formatAge = (diffMs: number) => {
        if (diffMs < 60000) return `${Math.floor(diffMs/1000)}s ago`;
        return `${Math.floor(diffMs/60000)}m ago`;
    };

    const getOpacityClass = (diffMs: number) => {
        if (diffMs > 120000) return 'opacity-stale-2m';
        if (diffMs > 30000) return 'opacity-stale-30s';
        return '';
    };

    const [filter, setFilter] = useState('');

    // To prevent the feed from being rendered backwards compared to what user wants (newest at bottom)
    // Actually, grants array has newest at index 0 (unshifted). We reverse it for rendering so newest is at bottom.
    // Client-side view filter only — does not change what the store retains.
    const q = filter.trim().toLowerCase();
    const filteredGrants = q
        ? grants.filter(g => {
            const tgId = g.talkgroupId || g.unitId || 'UNK';
            const info = DB[tgId] || { n: 'Unknown Target', a: 'UNK' };
            return (
                tgId.toLowerCase().includes(q) ||
                info.n.toLowerCase().includes(q) ||
                info.a.toLowerCase().includes(q)
            );
        })
        : grants;
    const reversedGrants = [...filteredGrants].reverse();
    const now = useNow();

    return (
        <div className="edacs-feed-panel">
            <div className="panel-header slers-accent">
                <span className="panel-title slers-title-color"><Activity size={12}/> Live Call Feed</span>
                <span className="panel-badge">{q ? `${filteredGrants.length}/${grants.length}` : grants.length} calls</span>
            </div>
            <div className="feed-filter-bar">
                <input
                    type="text"
                    className="feed-filter-input"
                    placeholder="Filter by tgid / agency / code…"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    aria-label="Filter call feed by talkgroup id, agency name, or agency code"
                />
            </div>
            <div className="feed-list" ref={feedRef}>
                {grants.length === 0 && <div className="empty-state">Awaiting Voice Channel Grants...</div>}
                {grants.length > 0 && filteredGrants.length === 0 && (
                    <div className="empty-state">No calls match “{filter}”.</div>
                )}
                {reversedGrants.map((g, i) => {
                    const tgId = g.talkgroupId || g.unitId || 'UNK';
                    const info = DB[tgId] || { n: 'Unknown Target', a: 'UNK' };
                    const diff = now - g.timestamp;
                    const timeStr = new Date(g.timestamp).toLocaleTimeString([], { hour12: false });
                    
                    return (
                        <div key={`${g.timestamp}-${i}`} className={`feed-item card-enter ${agClass(info.a)} ${getOpacityClass(diff)}`}>
                            <div className="feed-item-header">
                                <div className="feed-item-title-group">
                                    <span className={`grant-badge grant-${g.grantType.toLowerCase()}`}>{g.grantType}</span>
                                    <span className="feed-tgid">{tgId}</span>
                                </div>
                                <span className="feed-meta">LCN {g.logicalChannel || '--'} • VC {g.voiceChannel || '--'}</span>
                            </div>
                            <div className="feed-item-name">{info.n}</div>
                            <div className="feed-item-footer">
                                <span>{info.a}</span>
                                <div>
                                    <span className="feed-age">{formatAge(diff)}</span>
                                    <span className="feed-time">{timeStr}</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            {!autoScroll && (
                <button className="jump-to-latest" onClick={scrollToBottom}>
                    ⬇ Jump to latest
                </button>
            )}
        </div>
    );
}
