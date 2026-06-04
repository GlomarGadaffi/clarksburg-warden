import { ScannerDecoder } from './Decoder';
import type { EDACSEvent, P25Event, SerialPort, SerialAPI } from '../types';

export class SerialMonitor {
    port: SerialPort | null = null;
    reader: ReadableStreamDefaultReader<string> | null = null;
    writer: WritableStreamDefaultWriter<string> | null = null;
    connected = false;
    buffer = "";
    isBusy = false;
    cmdQueue: string[] = [];
    pollInt: number | null = null;

    /** Abort controller used to cancel the TextDecoderStream pipeTo chain. */
    private pipeAbort: AbortController | null = null;

    private edacsListeners: ((e: EDACSEvent) => void)[] = [];
    private p25Listeners: ((e: P25Event) => void)[] = [];
    private rawListeners: ((line: string) => void)[] = [];
    private statusListeners: ((connected: boolean) => void)[] = [];

    onEDACS(cb: (e: EDACSEvent) => void) {
        this.edacsListeners.push(cb);
        return () => { this.edacsListeners = this.edacsListeners.filter(l => l !== cb); };
    }

    onP25(cb: (e: P25Event) => void) {
        this.p25Listeners.push(cb);
        return () => { this.p25Listeners = this.p25Listeners.filter(l => l !== cb); };
    }

    onRawLine(cb: (line: string) => void) {
        this.rawListeners.push(cb);
        return () => { this.rawListeners = this.rawListeners.filter(l => l !== cb); };
    }

    onStatusChange(cb: (status: boolean) => void) {
        this.statusListeners.push(cb);
        return () => { this.statusListeners = this.statusListeners.filter(l => l !== cb); };
    }

    async connect() {
        try {
            const serial = (navigator as unknown as { serial: SerialAPI }).serial;
            this.port = await serial.requestPort();
            await this.port.open({ baudRate: 115200 });

            // Set up encoder (controller → scanner).
            // pipeTo returns a Promise that resolves/rejects when the pipe ends;
            // we must store the AbortController so disconnect() can close it cleanly.
            this.pipeAbort = new AbortController();
            const textEncoder = new TextEncoderStream();
            // Intentionally not awaited — the pipe runs for the life of the connection.
            // Rejection is handled via the abort signal in disconnect().
            textEncoder.readable.pipeTo(this.port.writable!, {
                signal: this.pipeAbort.signal
            }).catch(() => { /* aborted on disconnect — expected */ });
            this.writer = textEncoder.writable.getWriter();

            this.connected = true;
            this.notifyStatus();
            // readLoop is intentionally unawaited; it manages its own teardown.
            this.readLoop().catch(e => console.error("readLoop unexpected exit:", e));
            this.startPolling();
        } catch (e) {
            console.error("Connect failed:", e);
            this.disconnect();
        }
    }

    async disconnect() {
        this.connected = false;
        this.stopPolling();
        // Unblock the command queue so any waiters don't hang.
        this.isBusy = false;
        this.cmdQueue = [];
        this.notifyStatus();

        try {
            // Cancel the read side first so readLoop exits cleanly.
            if (this.reader) {
                await this.reader.cancel();
                this.reader = null;
            }
            // Abort and release the write-side pipe.
            if (this.pipeAbort) {
                this.pipeAbort.abort();
                this.pipeAbort = null;
            }
            if (this.writer) {
                this.writer.releaseLock();
                this.writer = null;
            }
            if (this.port) {
                await this.port.close();
                this.port = null;
            }
        } catch {
            // Best-effort cleanup — port may already be closed.
        }
    }

    private notifyStatus() {
        this.statusListeners.forEach(cb => cb(this.connected));
    }

    async readLoop() {
        if (!this.port?.readable) return;

        const textDecoder = new TextDecoderStream();
        // pipeTo locks port.readable — unawaited intentionally (runs until cancel).
        // Cast: ReadableStream<Uint8Array> → ReadableStream<BufferSource> is safe at
        // runtime since Uint8Array satisfies BufferSource; the cast is needed because
        // TypeScript 6 enforces strict variance on WritableStream's type parameter.
        (this.port.readable as ReadableStream<BufferSource>).pipeTo(textDecoder.writable).catch(() => { /* closed on disconnect */ });
        this.reader = textDecoder.readable.getReader();

        try {
            while (true) {
                const { value, done } = await this.reader.read();
                if (done) break;
                if (value) this.ingest(value);
            }
        } catch (e) {
            console.error("Read error:", e);
        } finally {
            // Release reader lock before disconnect() tries to cancel.
            try { this.reader?.releaseLock(); } catch { /* ignore */ }
            this.reader = null;
            this.disconnect();
        }
    }

    ingest(chunk: string) {
        this.buffer += chunk;
        const lines = this.buffer.split(/[\r\n]+/);
        this.buffer = lines.pop() || "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            this.rawListeners.forEach(cb => cb(trimmed));
            this.route(trimmed);
        }
    }

    route(line: string) {
        if (
            line.includes("EDW") ||
            line.includes("EDN") ||
            line.includes("SIT-") ||
            line.includes("PAT-") ||
            line.match(/TG-|CH-|LCN-|VC-/)
        ) {
            const edacsEvent = ScannerDecoder.parseEDACS(line);
            if (edacsEvent) {
                this.edacsListeners.forEach(cb => cb(edacsEvent));
            }
        } else if (line.startsWith("GLG")) {
            const p25Event = ScannerDecoder.parseP25(line);
            if (p25Event) {
                this.p25Listeners.forEach(cb => cb(p25Event));
            }
            // GLG is the only solicited response we poll for, so clear isBusy here.
            this.isBusy = false;
            this.processQueue();
        } else if (line.startsWith("KEY,") || line.startsWith("ERR")) {
            // KEY,OK (response to KEY,S,P / KEY,H,P) and ERR responses are unsolicited
            // acknowledgements — they are not GLG responses, but they do confirm the
            // scanner processed the last command, so we must clear isBusy here too.
            // Without this, a KEY command followed by silence would permanently stall
            // the command queue.
            this.isBusy = false;
            this.processQueue();
        }
    }

    queueCmd(cmd: string) {
        if (!this.connected) return;
        this.cmdQueue.push(cmd);
        this.processQueue();
    }

    async processQueue() {
        if (this.isBusy || this.cmdQueue.length === 0 || !this.writer) return;
        this.isBusy = true;
        const cmd = this.cmdQueue.shift();
        if (cmd) {
            try {
                await this.writer.write(cmd + "\r");
            } catch (e) {
                // Write failed (port likely closed); reset so the queue isn't permanently
                // stuck if reconnect is attempted.
                console.error("Write failed:", e);
                this.isBusy = false;
            }
        } else {
            // Shifted an undefined — shouldn't happen, but guard anyway.
            this.isBusy = false;
        }
    }

    startPolling() {
        this.pollInt = window.setInterval(() => this.queueCmd("GLG"), 150);
    }

    stopPolling() {
        if (this.pollInt) {
            clearInterval(this.pollInt);
            this.pollInt = null;
        }
    }
}

export const Serial = new SerialMonitor();
