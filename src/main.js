/**
 * main.js - Sentinel V11 Dashboard Controller
 * Main application entry point
 */

import * as engine from './engine.js';
import { lookupTGID, isKnownTGID } from './db.js';

// ============================================================
// STORAGE KEYS
// ============================================================
const STORAGE_KEYS = {
  PATCH_HITS: 'sentinel_patch_hits',
  TGID_HITS: 'sentinel_tgid_hits',
  SEEN_TGIDS: 'sentinel_seen_tgids',
  RAW_LOG: 'sentinel_raw_log'
};

// ============================================================
// APPLICATION STATE
// ============================================================
const state = {
  patchHits: {},      // { "PAT_ID": count }
  tgidHits: {},       // { "TGID": count }
  seenTGIDs: new Set(),
  rawLog: [],
  maxLogEntries: 500,
  statusPollInterval: null
};

// ============================================================
// DOM REFERENCES
// ============================================================
let DOM = {};

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initDOM();
  loadFromStorage();
  bindEvents();
  checkBrowserSupport();
  renderAll();
  startClock();
});

function initDOM() {
  DOM = {
    // Connection controls
    btnConnect: document.getElementById('btn-connect'),
    btnDisconnect: document.getElementById('btn-disconnect'),
    btnWipeDB: document.getElementById('btn-wipe'),
    connectionStatus: document.getElementById('connection-status'),

    // Kill chain controls
    btnHold: document.getElementById('btn-hold'),
    btnSkip: document.getElementById('btn-skip'),
    btnScan: document.getElementById('btn-scan'),

    // SLERS Panel (Left)
    patchMatrix: document.getElementById('patch-matrix'),
    patchCount: document.getElementById('patch-count'),

    // P25 Panel (Right)
    tacticalStream: document.getElementById('tactical-stream'),
    tgidCount: document.getElementById('tgid-count'),

    // Raw feed
    rawFeed: document.getElementById('raw-feed'),

    // Status
    clock: document.getElementById('clock'),
    errorDisplay: document.getElementById('error-display')
  };
}

function bindEvents() {
  // Connection controls
  DOM.btnConnect.addEventListener('click', handleConnect);
  DOM.btnDisconnect.addEventListener('click', handleDisconnect);
  DOM.btnWipeDB.addEventListener('click', handleWipeDB);

  // Kill chain
  DOM.btnHold.addEventListener('click', () => engine.cmdHold());
  DOM.btnSkip.addEventListener('click', () => engine.cmdSkip());
  DOM.btnScan.addEventListener('click', () => engine.cmdScan());

  // Register engine callbacks
  engine.registerCallbacks({
    onEDW: handleEDWData,
    onGLG: handleGLGData,
    onRaw: handleRawData,
    onConnection: handleConnectionChange,
    onError: handleError
  });
}

function checkBrowserSupport() {
  if (!engine.isSupported()) {
    showError('FATAL: Web Serial API not supported. Use Chrome 89+ or Edge 89+');
    DOM.btnConnect.disabled = true;
  }
}

// ============================================================
// CONNECTION HANDLERS
// ============================================================
async function handleConnect() {
  DOM.btnConnect.disabled = true;
  const success = await engine.connect();

  if (success) {
    // Start polling for status updates
    state.statusPollInterval = setInterval(() => {
      engine.cmdGetStatus();
    }, 500);
  } else {
    DOM.btnConnect.disabled = false;
  }
}

async function handleDisconnect() {
  if (state.statusPollInterval) {
    clearInterval(state.statusPollInterval);
    state.statusPollInterval = null;
  }
  await engine.disconnect();
}

function handleConnectionChange(connected) {
  if (connected) {
    DOM.connectionStatus.textContent = 'ONLINE';
    DOM.connectionStatus.classList.add('online');
    DOM.btnConnect.disabled = true;
    DOM.btnDisconnect.disabled = false;
    DOM.btnHold.disabled = false;
    DOM.btnSkip.disabled = false;
    DOM.btnScan.disabled = false;
  } else {
    DOM.connectionStatus.textContent = 'OFFLINE';
    DOM.connectionStatus.classList.remove('online');
    DOM.btnConnect.disabled = false;
    DOM.btnDisconnect.disabled = true;
    DOM.btnHold.disabled = true;
    DOM.btnSkip.disabled = true;
    DOM.btnScan.disabled = true;
  }
}

// ============================================================
// DATA HANDLERS
// ============================================================
function handleEDWData(data) {
  // Track patch hits
  data.patches.forEach(patch => {
    state.patchHits[patch] = (state.patchHits[patch] || 0) + 1;
  });

  // Track memory hits
  data.memories.forEach(mem => {
    const key = `MEM:${mem}`;
    state.patchHits[key] = (state.patchHits[key] || 0) + 1;
  });

  saveToStorage();
  renderPatchMatrix();
}

function handleGLGData(data) {
  if (!data.tgid) return;

  // Track TGID hits
  state.tgidHits[data.tgid] = (state.tgidHits[data.tgid] || 0) + 1;
  state.seenTGIDs.add(data.tgid);

  saveToStorage();
  renderTacticalStream(data);
}

function handleRawData(line) {
  const entry = {
    timestamp: Date.now(),
    line: line
  };

  state.rawLog.unshift(entry);

  // Limit log size
  if (state.rawLog.length > state.maxLogEntries) {
    state.rawLog.pop();
  }

  renderRawFeed(entry);
}

function handleError(message) {
  showError(message);
}

// ============================================================
// RENDERING
// ============================================================
function renderAll() {
  renderPatchMatrix();
  renderSeenTGIDs();
}

function renderPatchMatrix() {
  const entries = Object.entries(state.patchHits)
    .sort((a, b) => b[1] - a[1]);

  DOM.patchCount.textContent = entries.length;

  if (entries.length === 0) {
    DOM.patchMatrix.innerHTML = '<div class="empty-state">NO PATCH DATA</div>';
    return;
  }

  DOM.patchMatrix.innerHTML = entries.map(([id, count]) => {
    const isMem = id.startsWith('MEM:');
    const displayId = isMem ? id : `PAT:${id}`;
    const typeClass = isMem ? 'mem-entry' : 'pat-entry';

    return `
      <div class="matrix-entry ${typeClass}">
        <span class="entry-id">${displayId}</span>
        <span class="entry-count">${count}</span>
      </div>
    `;
  }).join('');
}

function renderTacticalStream(data) {
  const info = lookupTGID(data.tgid);
  const isKnown = isKnownTGID(data.tgid);
  const timestamp = formatTime(data.timestamp);

  const entry = document.createElement('div');
  entry.className = `tac-entry ${isKnown ? 'known' : 'unknown'}`;
  entry.innerHTML = `
    <div class="tac-header">
      <span class="tac-time">${timestamp}</span>
      <span class="tac-tgid">TG:${data.tgid}</span>
      ${data.srcId ? `<span class="tac-src">SRC:${data.srcId}</span>` : ''}
    </div>
    <div class="tac-body">
      <span class="tac-agency">${info.agency}</span>
      <span class="tac-desc">${info.desc}</span>
    </div>
    ${data.frequency ? `<div class="tac-freq">${data.frequency}</div>` : ''}
  `;

  // Insert at top
  DOM.tacticalStream.insertBefore(entry, DOM.tacticalStream.firstChild);

  // Limit displayed entries
  while (DOM.tacticalStream.children.length > 100) {
    DOM.tacticalStream.removeChild(DOM.tacticalStream.lastChild);
  }

  updateTGIDCount();
}

function renderSeenTGIDs() {
  // Render previously seen TGIDs on page load
  const sorted = Array.from(state.seenTGIDs).sort((a, b) => {
    const countA = state.tgidHits[a] || 0;
    const countB = state.tgidHits[b] || 0;
    return countB - countA;
  });

  DOM.tacticalStream.innerHTML = '';

  sorted.forEach(tgid => {
    const info = lookupTGID(tgid);
    const isKnown = isKnownTGID(tgid);
    const hits = state.tgidHits[tgid] || 0;

    const entry = document.createElement('div');
    entry.className = `tac-entry ${isKnown ? 'known' : 'unknown'} cached`;
    entry.innerHTML = `
      <div class="tac-header">
        <span class="tac-time">[${hits} hits]</span>
        <span class="tac-tgid">TG:${tgid}</span>
      </div>
      <div class="tac-body">
        <span class="tac-agency">${info.agency}</span>
        <span class="tac-desc">${info.desc}</span>
      </div>
    `;

    DOM.tacticalStream.appendChild(entry);
  });

  updateTGIDCount();
}

function renderRawFeed(entry) {
  const line = document.createElement('div');
  line.className = 'raw-line';

  // Highlight protocol markers
  let text = entry.line;
  if (text.startsWith('EDW')) {
    line.classList.add('raw-edw');
  } else if (text.startsWith('GLG')) {
    line.classList.add('raw-glg');
  }

  line.textContent = `[${formatTime(entry.timestamp)}] ${text}`;

  DOM.rawFeed.insertBefore(line, DOM.rawFeed.firstChild);

  // Limit displayed entries
  while (DOM.rawFeed.children.length > 200) {
    DOM.rawFeed.removeChild(DOM.rawFeed.lastChild);
  }
}

function updateTGIDCount() {
  DOM.tgidCount.textContent = state.seenTGIDs.size;
}

// ============================================================
// STORAGE
// ============================================================
function loadFromStorage() {
  try {
    const patchHits = localStorage.getItem(STORAGE_KEYS.PATCH_HITS);
    if (patchHits) state.patchHits = JSON.parse(patchHits);

    const tgidHits = localStorage.getItem(STORAGE_KEYS.TGID_HITS);
    if (tgidHits) state.tgidHits = JSON.parse(tgidHits);

    const seenTGIDs = localStorage.getItem(STORAGE_KEYS.SEEN_TGIDS);
    if (seenTGIDs) state.seenTGIDs = new Set(JSON.parse(seenTGIDs));

  } catch (err) {
    console.error('Failed to load from storage:', err);
  }
}

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.PATCH_HITS, JSON.stringify(state.patchHits));
    localStorage.setItem(STORAGE_KEYS.TGID_HITS, JSON.stringify(state.tgidHits));
    localStorage.setItem(STORAGE_KEYS.SEEN_TGIDS, JSON.stringify([...state.seenTGIDs]));
  } catch (err) {
    console.error('Failed to save to storage:', err);
  }
}

function handleWipeDB() {
  if (!confirm('WIPE ALL DATA? This cannot be undone.')) return;

  // Clear state
  state.patchHits = {};
  state.tgidHits = {};
  state.seenTGIDs.clear();
  state.rawLog = [];

  // Clear storage
  Object.values(STORAGE_KEYS).forEach(key => {
    localStorage.removeItem(key);
  });

  // Clear displays
  DOM.patchMatrix.innerHTML = '<div class="empty-state">NO PATCH DATA</div>';
  DOM.tacticalStream.innerHTML = '<div class="empty-state">NO TGID DATA</div>';
  DOM.rawFeed.innerHTML = '';
  DOM.patchCount.textContent = '0';
  DOM.tgidCount.textContent = '0';
}

// ============================================================
// UTILITIES
// ============================================================
function formatTime(timestamp) {
  const d = new Date(timestamp);
  return d.toTimeString().split(' ')[0];
}

function startClock() {
  function updateClock() {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const dateStr = now.toISOString().split('T')[0];
    DOM.clock.textContent = `${dateStr} ${timeStr}`;
  }

  updateClock();
  setInterval(updateClock, 1000);
}

function showError(message) {
  DOM.errorDisplay.textContent = message;
  DOM.errorDisplay.classList.add('visible');

  setTimeout(() => {
    DOM.errorDisplay.classList.remove('visible');
  }, 5000);
}
