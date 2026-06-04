import { useEffect, useRef } from 'react';
import { useSentinelState } from '../core/useSentinel';
import { X } from 'lucide-react';
import './RawLogDrawer.css';

interface RawLogDrawerProps {
    open: boolean;
    onClose: () => void;
}

export default function RawLogDrawer({ open, onClose }: RawLogDrawerProps) {
    const { rawLog } = useSentinelState();
    const scrollRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);

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
                <span>RAW SERIAL OUTPUT (LAST 200 LINES)</span>
                <button
                    ref={closeRef}
                    onClick={onClose}
                    aria-label="Close raw log drawer"
                    title="Close"
                >
                    <X size={12} aria-hidden="true" />
                </button>
            </div>
            <div className="raw-log-content" ref={scrollRef}>
                {rawLog.length === 0 && (
                    <div className="raw-log-empty">No serial data yet. Connect a scanner to see output.</div>
                )}
                {rawLog.map((log, i) => (
                    <div key={`${log.timestamp}-${i}`} className="raw-log-line">
                        <span className="log-time">{new Date(log.timestamp).toISOString()}</span>
                        <span className={`log-text ${getLineClass(log.line)}`}>{log.line}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
