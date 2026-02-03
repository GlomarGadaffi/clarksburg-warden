/**
 * db.js - Talkgroup Intelligence Database
 * Maps TGIDs to agency names and descriptions
 *
 * Format: { "TGID": { agency: "Agency Name", desc: "Description" } }
 */

export const TGID_DATABASE = {
  // Law Enforcement
  "2057": { agency: "County Sheriff", desc: "Dispatch Primary" },
  "2058": { agency: "County Sheriff", desc: "Tactical 1" },
  "2059": { agency: "County Sheriff", desc: "Tactical 2" },
  "2060": { agency: "County Sheriff", desc: "Car-to-Car" },
  "2061": { agency: "County Sheriff", desc: "Investigations" },

  // City Police
  "3100": { agency: "City PD", desc: "Dispatch North" },
  "3101": { agency: "City PD", desc: "Dispatch South" },
  "3102": { agency: "City PD", desc: "Traffic Division" },
  "3103": { agency: "City PD", desc: "SWAT/TAC" },
  "3104": { agency: "City PD", desc: "Detectives" },

  // Fire/EMS
  "4200": { agency: "County Fire", desc: "Dispatch" },
  "4201": { agency: "County Fire", desc: "Fireground 1" },
  "4202": { agency: "County Fire", desc: "Fireground 2" },
  "4203": { agency: "County Fire", desc: "Command" },
  "4210": { agency: "EMS", desc: "Dispatch" },
  "4211": { agency: "EMS", desc: "Hospital Patch" },
  "4212": { agency: "EMS", desc: "TAC" },

  // State Agencies
  "5000": { agency: "State Police", desc: "Troop A Dispatch" },
  "5001": { agency: "State Police", desc: "Troop B Dispatch" },
  "5010": { agency: "State Police", desc: "Statewide Call" },
  "5020": { agency: "DOT", desc: "Highway Ops" },

  // Federal
  "6100": { agency: "Federal", desc: "Interop Channel" },
  "6200": { agency: "USCG", desc: "Marine Safety" },

  // Utilities
  "7000": { agency: "Electric Co", desc: "Dispatch" },
  "7001": { agency: "Electric Co", desc: "Storm Ops" },
  "7100": { agency: "Gas Co", desc: "Emergency" },
  "7200": { agency: "Water Dept", desc: "Operations" },

  // Transit
  "8000": { agency: "Metro Transit", desc: "Bus Dispatch" },
  "8001": { agency: "Metro Transit", desc: "Rail Ops" },
  "8010": { agency: "School Bus", desc: "Dispatch" },

  // Interop
  "9000": { agency: "INTEROP", desc: "VCALL10" },
  "9001": { agency: "INTEROP", desc: "VTAC11" },
  "9002": { agency: "INTEROP", desc: "VTAC12" },
  "9003": { agency: "INTEROP", desc: "VTAC13" },
  "9004": { agency: "INTEROP", desc: "VTAC14" }
};

/**
 * Lookup a TGID and return agency info
 * @param {string} tgid - The talkgroup ID
 * @returns {object} - { agency, desc } or default unknown
 */
export function lookupTGID(tgid) {
  const normalized = String(tgid).trim();
  return TGID_DATABASE[normalized] || {
    agency: "UNKNOWN",
    desc: `TGID ${normalized}`
  };
}

/**
 * Check if TGID exists in database
 * @param {string} tgid
 * @returns {boolean}
 */
export function isKnownTGID(tgid) {
  return String(tgid).trim() in TGID_DATABASE;
}

/**
 * Get all TGIDs for a specific agency
 * @param {string} agencyName
 * @returns {string[]}
 */
export function getTGIDsByAgency(agencyName) {
  const results = [];
  for (const [tgid, info] of Object.entries(TGID_DATABASE)) {
    if (info.agency.toLowerCase().includes(agencyName.toLowerCase())) {
      results.push(tgid);
    }
  }
  return results;
}
