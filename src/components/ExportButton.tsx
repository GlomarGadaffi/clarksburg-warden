import { useState } from 'react';
import { useSentinelStore } from '../core/useSentinel';

export default function ExportButton() {
    const store = useSentinelStore();
    const [open, setOpen] = useState(false);

    return (
        <div className="export-menu-wrapper">
            <button className="hdr-btn btn-wipe" onClick={() => setOpen(!open)}>
                Export ▼
            </button>
            {open && (
                <div className="export-menu">
                    <button className="hdr-btn btn-wipe" onClick={() => { store.exportJSON(); setOpen(false); }}>JSON</button>
                    <button className="hdr-btn btn-wipe" onClick={() => { store.exportCSV(); setOpen(false); }}>CSV</button>
                </div>
            )}
        </div>
    );
}
