import { useRef, useState } from 'react';
import { useSentinelStore } from '../core/useSentinel';
import { Serial } from '../core/SerialMonitor';
import { Upload } from 'lucide-react';

// ─── Session Import / Replay ──────────────────────────────────────────────────
// Accepts a JSON file via FileReader and either:
//   (a) restores a previously exported session (the exportJSON shape) into the
//       store for offline review via store.importSession(), OR
//   (b) replays a raw-line capture by streaming the lines back through the SAME
//       Serial.ingest path real hardware uses, on a timer.
// Malformed files surface a user-visible error and never crash the app.
// ──────────────────────────────────────────────────────────────────────────────

/** Extract a raw-line array from a capture file, if the file is one. */
function extractRawLines(data: unknown): string[] | null {
    if (Array.isArray(data) && data.every(x => typeof x === 'string')) {
        return data as string[];
    }
    if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        if (Array.isArray(d.rawLines) && d.rawLines.every(x => typeof x === 'string')) {
            return d.rawLines as string[];
        }
        // rawLog (RawLogEntry[]) — pull the .line field out.
        if (Array.isArray(d.rawLog)) {
            const lines = (d.rawLog as unknown[])
                .map(e => (e && typeof e === 'object' ? (e as Record<string, unknown>).line : undefined))
                .filter((l): l is string => typeof l === 'string');
            if (lines.length) return lines;
        }
    }
    return null;
}

/** Heuristic: does this look like an exported session (vs a raw capture)? */
function looksLikeSession(data: unknown): boolean {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const d = data as Record<string, unknown>;
    return 'persistentSlers' in d || 'persistentP25' in d || 'grants' in d || 'stats' in d;
}

export default function ReplayButton() {
    const store = useSentinelStore();
    const inputRef = useRef<HTMLInputElement>(null);
    const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
    const replayTimer = useRef<number | null>(null);

    const stopReplay = () => {
        if (replayTimer.current !== null) {
            clearInterval(replayTimer.current);
            replayTimer.current = null;
        }
    };

    const handleFile = (file: File) => {
        const reader = new FileReader();
        reader.onerror = () => setStatus({ kind: 'err', msg: 'Could not read file.' });
        reader.onload = () => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(String(reader.result));
            } catch {
                setStatus({ kind: 'err', msg: 'Invalid JSON file.' });
                return;
            }

            // Prefer a raw-line capture (replay) when present and the file is not a
            // full session export.
            const rawLines = extractRawLines(parsed);
            if (rawLines && !looksLikeSession(parsed)) {
                stopReplay();
                let i = 0;
                replayTimer.current = window.setInterval(() => {
                    if (i >= rawLines.length) {
                        stopReplay();
                        return;
                    }
                    Serial.ingest(rawLines[i] + '\r\n');
                    i++;
                }, 120);
                setStatus({ kind: 'ok', msg: `Replaying ${rawLines.length} raw lines…` });
                return;
            }

            // Otherwise treat it as a session export and restore it.
            try {
                store.importSession(parsed);
                setStatus({ kind: 'ok', msg: 'Session restored.' });
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'Could not import session.';
                setStatus({ kind: 'err', msg });
            }
        };
        reader.readAsText(file);
    };

    const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
        // Reset so selecting the same file again re-triggers onChange.
        e.target.value = '';
    };

    return (
        <div className="replay-wrapper">
            <input
                ref={inputRef}
                type="file"
                accept="application/json,.json"
                onChange={onChange}
                style={{ display: 'none' }}
                aria-hidden="true"
                tabIndex={-1}
            />
            <button
                className="hdr-btn btn-wipe"
                onClick={() => inputRef.current?.click()}
                aria-label="Replay or import a session file"
            >
                <Upload size={12} aria-hidden="true" />
                Replay
            </button>
            {status && (
                <span
                    className={`replay-status ${status.kind === 'err' ? 'replay-err' : 'replay-ok'}`}
                    role="status"
                >
                    {status.msg}
                </span>
            )}
        </div>
    );
}
