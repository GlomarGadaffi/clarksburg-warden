export interface EDACSEvent {
  type: 'SITE' | 'PATCH' | 'GRANT' | 'UNKNOWN';
  raw: string;
  timestamp: number;
}

export interface SiteEvent extends EDACSEvent {
  type: 'SITE';
  siteId: string;
}

export interface PatchEvent extends EDACSEvent {
  type: 'PATCH';
  patchId: string;
  memberId: string;
}

export interface GrantEvent extends EDACSEvent {
  type: 'GRANT';
  talkgroupId?: string;
  logicalChannel?: string;
  voiceChannel?: string;
  unitId?: string;
  grantType: 'TG' | 'ICALL' | 'CPT' | 'UNKNOWN';
}

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
