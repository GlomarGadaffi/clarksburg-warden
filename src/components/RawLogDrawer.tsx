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

    useEffect(() => {
        if (open && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [rawLog, open]);

    const getLineClass = (line: string) => {
        if (line.startsWith('EDW') || line.startsWith('EDN')) return 'log-edw';
        if (line.startsWith('GLG')) return 'log-glg';
        if (line.includes('ERR')) return 'log-err';
        return '';
    };

    if (!open) return null;

    return (
        <div className="raw-log-drawer">
            <div className="raw-log-header">
                <span>RAW SERIAL OUTPUT (LAST 200 LINES)</span>
                <button onClick={onClose} title="Close drawer"><X size={12} /></button>
            </div>
            <div className="raw-log-content" ref={scrollRef}>
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
