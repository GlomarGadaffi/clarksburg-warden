import { ScannerDecoder } from './Decoder';
import type { EDACSEvent, P25Event } from '../types';

type AnyEventCallback = (e: any) => void;

export class SerialMonitor {
    port: any | null = null;
    reader: ReadableStreamDefaultReader<string> | null = null;
    writer: WritableStreamDefaultWriter<string> | null = null;
    connected = false;
    buffer = "";
    isBusy = false;
    cmdQueue: string[] = [];
    pollInt: number | null = null;

    private edacsListeners: AnyEventCallback[] = [];
    private p25Listeners: AnyEventCallback[] = [];
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
            this.port = await (navigator as any).serial.requestPort();
            await this.port.open({ baudRate: 115200 });
            
            const textEncoder = new TextEncoderStream();
            textEncoder.readable.pipeTo(this.port.writable!);
            this.writer = textEncoder.writable.getWriter();
            
            this.connected = true;
            this.notifyStatus();
            this.readLoop();
            this.startPolling();
        } catch(e) {
            console.error("Connect failed:", e);
            this.disconnect();
        }
    }

    async disconnect() {
        this.connected = false;
        this.stopPolling();
        this.notifyStatus();

        try {
            if (this.reader) await this.reader.cancel();
            if (this.writer) { this.writer.releaseLock(); this.writer = null; }
            if (this.port) { await this.port.close(); this.port = null; }
        } catch(e) { 
        }
    }

    private notifyStatus() {
        this.statusListeners.forEach(cb => cb(this.connected));
    }

    async readLoop() {
        const textDecoder = new TextDecoderStream();
        this.port!.readable!.pipeTo(textDecoder.writable);
        this.reader = textDecoder.readable.getReader();

        try {
            while (true) {
                const { value, done } = await this.reader.read();
                if (done) break;
                if (value) this.ingest(value);
            }
        } catch(e) { 
            console.error("Read error:", e); 
        } finally {
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
        if (line.includes("EDW") || line.includes("EDN") || line.includes("SIT-") || line.includes("PAT-") || line.match(/TG-|CH-|LCN-|VC-/)) {
            const edacsEvent = ScannerDecoder.parseEDACS(line);
            if (edacsEvent) {
                this.edacsListeners.forEach(cb => cb(edacsEvent));
            }
        } else if (line.startsWith("GLG")) {
            const p25Event = ScannerDecoder.parseP25(line);
            if (p25Event) {
                this.p25Listeners.forEach(cb => cb(p25Event));
            }
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
            } catch(e) {
                this.isBusy = false;
            }
        }
    }

    startPolling() {
        this.pollInt = window.setInterval(() => this.queueCmd("GLG"), 150);
    }

    stopPolling() {
        if (this.pollInt) clearInterval(this.pollInt);
    }
}

export const Serial = new SerialMonitor();
