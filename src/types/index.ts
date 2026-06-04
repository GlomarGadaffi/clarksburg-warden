// Web Serial API types (not in lib.dom.d.ts for all TS versions)
export interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<BufferSource> | null;
  getInfo(): SerialPortInfo;
}

export interface SerialPortRequestOptions {
  filters?: SerialPortInfo[];
}

// Extend Navigator with Web Serial API
export interface SerialAPI {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

// ─── EDACS Event Discriminated Union ──────────────────────────────────────────

export interface EDACSEventBase {
  raw: string;
  timestamp: number;
}

export interface SiteEvent extends EDACSEventBase {
  type: 'SITE';
  siteId: string;
}

export interface PatchEvent extends EDACSEventBase {
  type: 'PATCH';
  patchId: string;
  memberId: string;
}

export interface GrantEvent extends EDACSEventBase {
  type: 'GRANT';
  talkgroupId?: string;
  logicalChannel?: string;
  voiceChannel?: string;
  unitId?: string;
  grantType: 'TG' | 'ICALL' | 'CPT' | 'UNKNOWN';
}

export interface UnknownEDACSEvent extends EDACSEventBase {
  type: 'UNKNOWN';
}

/** Discriminated union — exhaustive matching is now possible */
export type EDACSEvent = SiteEvent | PatchEvent | GrantEvent | UnknownEDACSEvent;

// ─── P25 / GLG ────────────────────────────────────────────────────────────────

export interface P25Event {
  tgid: string;
  systemName: string;
  groupName: string;
  channelName: string;
  isSquelchOpen: boolean;
  timestamp: number;
}

export interface RawLogEntry {
  line: string;
  timestamp: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  agency: string;
  h5: number;
  h60: number;
}

export interface SessionStats {
  sessionStart: number;
  patches: number;
  grants: number;
  p25Total: number;
}
