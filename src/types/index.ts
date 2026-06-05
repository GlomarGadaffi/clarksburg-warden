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
  // P25 control-channel system identity (from SID-/WACN-/SIT- frames). Optional
  // because EDACS SITE events only carry siteId, and each P25 frame typically
  // carries only one of these fields.
  wacn?: string;
  sysId?: string;
  site?: string;
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
  // For P25 CNM grants the voice channel is an actual RF frequency, formatted as
  // a display string e.g. "852.7750 MHz". Absent for EDACS (which never sends RF).
  frequency?: string;
  // Origin of the grant so the UI can label EDACS vs P25 control-channel grants.
  source?: 'EDACS' | 'P25';
}

export interface UnknownEDACSEvent extends EDACSEventBase {
  type: 'UNKNOWN';
}

/**
 * An EDACS logical ID (group or unit) seen active on the control channel — decoded
 * from "UN"-tagged OSWs whose payload is a plain LID (no LCN/status in the high
 * bits). Feeds the activity leaderboard even when no voice channel is followed.
 */
export interface UnitEvent extends EDACSEventBase {
  type: 'UNIT';
  id: string;          // decimal LID (AgencyDB key)
  mt: string;          // OSW message-type byte (hex), for diagnostics
}

/** Discriminated union — exhaustive matching is now possible */
export type EDACSEvent = SiteEvent | PatchEvent | GrantEvent | UnknownEDACSEvent | UnitEvent;

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
