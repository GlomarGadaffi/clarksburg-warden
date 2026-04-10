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
  grantType: 'TG' | 'ICALL' | 'UNKNOWN';
}

export interface P25Event {
  tgid: string;
  systemName: string;
  groupName: string;
  channelName: string;
  isSquelchOpen: boolean;
  timestamp: number;
}
