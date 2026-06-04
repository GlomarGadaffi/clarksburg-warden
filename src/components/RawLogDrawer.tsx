import { useEffect, useRef, useState } from 'react';
import { useSentinelState } from '../core/useSentinel';
import { DB } from '../core/AgencyDB';
import { X } from 'lucide-react';
import './RawLogDrawer.css';

interface RawLogDrawerProps {
    open: boolean;
    onClose: () => void;
}

/**
 * Map a raw line's TG-/GLG tgid to its DB agency name + code so an agency/keyword
 * filter can match raw lines that don't literally contain the agency text.
 * EDACS TG- tokens are hex (→ decimal DB key); P25 GLG field[1] is decimal.
 */
function agencyHint(line: string): string {
    const tgM = line.match(/TG-([0-9A-Fa-f]+)/);
    if (tgM) {
        const dec = parseInt(tgM[1], 16).toString(10);
        const info = DB[dec];
        if (info) return `${dec} ${info.n} ${info.a}`;
        return dec;
    }
    if (line.startsWith('GLG,')) {
        const tgid = line.split(',')[1];
        const info = tgid ? DB[tgid] : undefined;
        if (info) return `${tgid} ${info.n} ${info.a}`;
        return tgid || '';
    }
    return '';
}

export default function RawLogDrawer({ open, onClose }: RawLogDrawerProps) {
    const { rawLog } = useSentinelState();
    const scrollRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const [filter, setFilter] = useState('');

    // Client-side view filter only — store retention (200-line cap) is unchanged.
    const q = filter.trim().toLowerCase();
    const filteredLog = q
        ? rawLog.filter(l =>
            l.line.toLowerCase().includes(q) ||
            agencyHint(l.line).toLowerCase().includes(q)
        )
        : rawLog;

    useEffect(() => {
        if (open && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [rawLog, open]);

    // Move focus to close button when drawer opens
    useEffect(() => {
        if (open && closeRef.current) {
            closeRef.current.focus();
        }
    }, [open]);

    const getLineClass = (line: string) => {
        if (line.startsWith('EDW') || line.startsWith('EDN')) return 'log-edw';
        if (line.startsWith('GLG')) return 'log-glg';
        if (line.includes('ERR')) return 'log-err';
        return '';
    };

    if (!open) return null;

    return (
        <div
            className="raw-log-drawer"
            id="raw-log-drawer"
            role="region"
            aria-label="Raw serial output"
        >
            <div className="raw-log-header">
                <span>RAW SERIAL OUTPUT (LAST 200 LINES){q ? ` — ${filteredLog.length} match` : ''}</span>
                <div className="raw-log-header-actions">
                    <input
                        type="text"
                        className="raw-log-filter"
                        placeholder="Filter lines / agency / keyword…"
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        aria-label="Filter raw log by line text, agency, or keyword"
                    />
                    <button
                        ref={closeRef}
                        onClick={onClose}
                        aria-label="Close raw log drawer"
                        title="Close"
                    >
                        <X size={12} aria-hidden="true" />
                    </button>
                </div>
            </div>
            <div className="raw-log-content" ref={scrollRef}>
                {rawLog.length === 0 && (
                    <div className="raw-log-empty">No serial data yet. Connect a scanner to see output.</div>
                )}
                {rawLog.length > 0 && filteredLog.length === 0 && (
                    <div className="raw-log-empty">No lines match “{filter}”.</div>
                )}
                {filteredLog.map((log, i) => (
                    <div key={`${log.timestamp}-${i}`} className="raw-log-line">
                        <span className="log-time">{new Date(log.timestamp).toISOString()}</span>
                        <span className={`log-text ${getLineClass(log.line)}`}>{log.line}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
