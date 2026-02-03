/**
 * engine.js - Serial Communication Engine
 * Handles Web Serial API connection and protocol parsing for BCD325P2
 *
 * Protocols:
 *   - EDW (SLERS/EDACS): PAT-[hex], MEM-[hex] patch tracking
 *   - GLG (P25): Comma-separated talkgroup info
 */

// Connection state
let port = null;
let reader = null;
let writer = null;
let readLoopActive = false;

// Configuration
const BAUD_RATE = 115200;
const LINE_TERMINATOR = '\r';

// Regex patterns for protocol parsing
const PATTERNS = {
  EDW_PAT: /PAT-([0-9A-Fa-f]+)/g,
  EDW_MEM: /MEM-([0-9A-Fa-f]+)/g,
  // GLG response format: GLG,FRQ,MOD,ATT,CTCSS/DCS,NAME,SQL,MUT,SYS_TAG,CHAN_TAG,P25NAC,TGID,...
  GLG_TGID: /^GLG,.*$/
};

// Event callbacks
let onEDWData = null;
let onGLGData = null;
let onRawData = null;
let onConnectionChange = null;
let onError = null;

/**
 * Check if Web Serial API is supported
 * @returns {boolean}
 */
export function isSupported() {
  return 'serial' in navigator;
}

/**
 * Check if currently connected
 * @returns {boolean}
 */
export function isConnected() {
  return port !== null && readLoopActive;
}

/**
 * Register event callbacks
 * @param {object} callbacks - { onEDW, onGLG, onRaw, onConnection, onError }
 */
export function registerCallbacks(callbacks) {
  if (callbacks.onEDW) onEDWData = callbacks.onEDW;
  if (callbacks.onGLG) onGLGData = callbacks.onGLG;
  if (callbacks.onRaw) onRawData = callbacks.onRaw;
  if (callbacks.onConnection) onConnectionChange = callbacks.onConnection;
  if (callbacks.onError) onError = callbacks.onError;
}

/**
 * Connect to scanner via Web Serial
 * @returns {Promise<boolean>}
 */
export async function connect() {
  if (!isSupported()) {
    emitError('Web Serial API not supported. Use Chrome or Edge.');
    return false;
  }

  try {
    // Request port from user
    port = await navigator.serial.requestPort();

    // Open with scanner baud rate
    await port.open({
      baudRate: BAUD_RATE,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none'
    });

    // Setup writer
    const textEncoder = new TextEncoderStream();
    const writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
    writer = textEncoder.writable.getWriter();

    // Start read loop
    readLoopActive = true;
    readLoop();

    emitConnectionChange(true);
    return true;

  } catch (err) {
    emitError(`Connection failed: ${err.message}`);
    port = null;
    return false;
  }
}

/**
 * Disconnect from scanner
 */
export async function disconnect() {
  readLoopActive = false;

  try {
    if (reader) {
      await reader.cancel();
      reader = null;
    }

    if (writer) {
      await writer.close();
      writer = null;
    }

    if (port) {
      await port.close();
      port = null;
    }

    emitConnectionChange(false);

  } catch (err) {
    emitError(`Disconnect error: ${err.message}`);
  }
}

/**
 * Main read loop - processes incoming serial data line by line
 */
async function readLoop() {
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
  reader = textDecoder.readable.getReader();

  let buffer = '';

  try {
    while (readLoopActive) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        buffer += value;

        // Process complete lines
        let lineEnd;
        while ((lineEnd = buffer.indexOf(LINE_TERMINATOR)) !== -1) {
          const line = buffer.substring(0, lineEnd).trim();
          buffer = buffer.substring(lineEnd + 1);

          if (line.length > 0) {
            processLine(line);
          }
        }
      }
    }
  } catch (err) {
    if (readLoopActive) {
      emitError(`Read error: ${err.message}`);
    }
  }
}

/**
 * Process a single line of serial data
 * @param {string} line
 */
function processLine(line) {
  // Emit raw data
  if (onRawData) {
    onRawData(line);
  }

  // Protocol 1: EDW (SLERS/EDACS)
  if (line.startsWith('EDW')) {
    parseEDW(line);
    return;
  }

  // Protocol 2: GLG (P25)
  if (line.startsWith('GLG')) {
    parseGLG(line);
    return;
  }
}

/**
 * Parse EDW (SLERS/EDACS) protocol line
 * Extracts PAT-[hex] and MEM-[hex] patch identifiers
 * @param {string} line
 */
function parseEDW(line) {
  const data = {
    raw: line,
    timestamp: Date.now(),
    patches: [],
    memories: []
  };

  // Extract PAT identifiers
  let match;
  const patRegex = /PAT-([0-9A-Fa-f]+)/g;
  while ((match = patRegex.exec(line)) !== null) {
    data.patches.push(match[1].toUpperCase());
  }

  // Extract MEM identifiers
  const memRegex = /MEM-([0-9A-Fa-f]+)/g;
  while ((match = memRegex.exec(line)) !== null) {
    data.memories.push(match[1].toUpperCase());
  }

  if (onEDWData) {
    onEDWData(data);
  }
}

/**
 * Parse GLG (P25) protocol line
 * GLG response format (comma-separated):
 * GLG,FRQ,MOD,ATT,CTCSS_DCS,NAME,SQL,MUT,SYS_TAG,CHAN_TAG,P25NAC,NUMBER1,NUMBER2,...
 *
 * Key fields:
 *   [1] FRQ - Frequency
 *   [4] CTCSS/DCS
 *   [5] NAME - Channel name
 *   [8] SYS_TAG - System tag
 *   [9] CHAN_TAG - Channel tag
 *   [10] P25NAC - P25 NAC
 *   [11+] NUMBER fields - contain TGID for P25
 *
 * @param {string} line
 */
function parseGLG(line) {
  const fields = line.split(',');

  const data = {
    raw: line,
    timestamp: Date.now(),
    frequency: fields[1] || '',
    modulation: fields[2] || '',
    attenuation: fields[3] || '',
    ctcss_dcs: fields[4] || '',
    name: fields[5] || '',
    squelch: fields[6] || '',
    mute: fields[7] || '',
    sysTag: fields[8] || '',
    chanTag: fields[9] || '',
    p25nac: fields[10] || '',
    tgid: null,
    srcId: null
  };

  // Extract TGID (usually in NUMBER1 field, position 11)
  if (fields.length > 11 && fields[11]) {
    const tgidCandidate = fields[11].trim();
    if (/^\d+$/.test(tgidCandidate)) {
      data.tgid = tgidCandidate;
    }
  }

  // Extract Source ID if present (NUMBER2 field, position 12)
  if (fields.length > 12 && fields[12]) {
    const srcCandidate = fields[12].trim();
    if (/^\d+$/.test(srcCandidate)) {
      data.srcId = srcCandidate;
    }
  }

  if (onGLGData) {
    onGLGData(data);
  }
}

/**
 * Send a command to the scanner
 * @param {string} command
 * @returns {Promise<boolean>}
 */
export async function sendCommand(command) {
  if (!writer) {
    emitError('Not connected - cannot send command');
    return false;
  }

  try {
    await writer.write(command + LINE_TERMINATOR);
    return true;
  } catch (err) {
    emitError(`Send failed: ${err.message}`);
    return false;
  }
}

// ============================================================
// KILL CHAIN COMMANDS
// ============================================================

/**
 * HOLD - Lock scanner on current channel
 * KEY,H,P = Press Hold key
 */
export async function cmdHold() {
  return sendCommand('KEY,H,P');
}

/**
 * SKIP/RESUME - Skip current channel or resume scanning
 * KEY,S,P = Press Skip key
 */
export async function cmdSkip() {
  return sendCommand('KEY,S,P');
}

/**
 * SCAN - Resume scanning
 * KEY,E,P = Press Scan/Search key
 */
export async function cmdScan() {
  return sendCommand('KEY,E,P');
}

/**
 * Request current status (GLG query)
 * Triggers scanner to send GLG response
 */
export async function cmdGetStatus() {
  return sendCommand('GLG');
}

/**
 * Request scanner model info
 */
export async function cmdGetModel() {
  return sendCommand('MDL');
}

/**
 * Set squelch level (0-15)
 * @param {number} level
 */
export async function cmdSetSquelch(level) {
  const clampedLevel = Math.max(0, Math.min(15, Math.floor(level)));
  return sendCommand(`SQL,${clampedLevel}`);
}

/**
 * Volume up
 */
export async function cmdVolumeUp() {
  return sendCommand('KEY,>,P');
}

/**
 * Volume down
 */
export async function cmdVolumeDown() {
  return sendCommand('KEY,<,P');
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function emitError(message) {
  console.error('[ENGINE]', message);
  if (onError) {
    onError(message);
  }
}

function emitConnectionChange(connected) {
  if (onConnectionChange) {
    onConnectionChange(connected);
  }
}
