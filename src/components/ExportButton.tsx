import { useState, useRef, useEffect } from 'react';
import { useSentinelStore } from '../core/useSentinel';
import { Download, ChevronDown } from 'lucide-react';

export default function ExportButton() {
    const store = useSentinelStore();
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Close dropdown when focus leaves the wrapper
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') setOpen(false);
    };

    return (
        <div className="export-menu-wrapper" ref={wrapperRef} onKeyDown={handleKeyDown}>
            <button
                className="hdr-btn btn-wipe"
                onClick={() => setOpen(v => !v)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Export data"
            >
                <Download size={12} aria-hidden="true" />
                Export
                <ChevronDown size={10} aria-hidden="true" style={{ opacity: 0.6 }} />
            </button>
            {open && (
                <div className="export-menu" role="menu">
                    <button
                        className="hdr-btn btn-wipe"
                        role="menuitem"
                        onClick={() => { store.exportJSON(); setOpen(false); }}
                    >
                        JSON
                    </button>
                    <button
                        className="hdr-btn btn-wipe"
                        role="menuitem"
                        onClick={() => { store.exportCSV(); setOpen(false); }}
                    >
                        CSV
                    </button>
                </div>
            )}
        </div>
    );
}
