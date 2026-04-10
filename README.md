<div align="center">
  <img src="BearSentinel.png" alt="BearSentinel Logo" width="120" style="margin-bottom: 20px;" />
  <h1>BearSentinel</h1>
  <p><strong>Heuristics & Telemetry Dashboard for Uniden Scanners via Web Serial API</strong></p>
</div>

---

The BearSentinel dashboard provides two primary operational modes designed to decode, visualize, and persist radio network telemetry directly from Uniden hardware (specifically the BCD325P2). Operating entirely offline via the Web Serial API, its main capabilities are divided into two distinct dashboards:

### 1. EDACS Exclusive Mode (SLERS)
This mode is dedicated to deeply analyzing EDACS format control channels, such as the State of Florida's Statewide Law Enforcement Radio System (SLERS). By intercepting raw EDW telemetry strings, it provides:
*   **Real-Time Patch Matrix:** Actively monitors and tracks spontaneous multi-agency operational patches as they occur, featuring animated TX indicators for live activity.
*   **Live Call Feed:** Decodes Control Channel Grants (`TG`, `ICALL`, `CPT`) to reveal exactly who is actively keying their radio. It maps out the allocated Logical Channel Number (repeater slot) or Voice Channel frequency—working **even if the actual voice traffic is encrypted**. Custom opacity fading gracefully decays older calls.
*   **Rolling Leaderboard:** Ranks Talkgroups by activity spikes over dynamic 5-minute and 60-minute trailing windows to rapidly identify major ongoing incidents.

### 2. Unified Mode (EDACS + P25 Phase I/II)
This hybrid dashboard merges EDACS patch tracking with active P25 network polling, which is specifically designed for monitoring local municipal systems. Its main capabilities include:
*   **Visual Tactical Grid:** Uses high-speed serial GLG polling at 150ms intervals to continuously map scanner activity onto an interactive visual grid.
*   **Direct Scanner Override:** Users can click on a talkgroup card directly in the dashboard to aggressively issue a "Hold" command (`KEY,H,P`) over the serial connection, allowing the dashboard to physically override the scanner's internal scan engine.
*   **Talkgroup Discovery:** Automatically highlights newly discovered Talkgroups while exploring the radio system.

### Offline Telemetry Tracking & Export
Beyond live visualization, the dashboard continuously persists telemetry metrics via a centralized state engine. 
*   **Zero-Cloud Persistence:** Because BearSentinel operates as a strict client-side application, all of this data is securely written to your local browser sandbox (`localStorage`) and is **never pushed to the cloud**.
*   **Session Export:** Full session telemetry, including a flat CSV of all intercepted call grants and a structured JSON state dump, can be exported at any time for post-incident review.
*   **Diagnostic Raw Log:** A togglable, syntax-highlighted raw serial output drawer streams the last 200 intercepted scanner commands directly in the UI.

---

## Telemetry Exploitation

BearSentinel extends beyond standard call following by weaponizing the native telemetry of the control channel infrastructure:

*   **Targeted Unit Tracking:** Maps 14-bit Logical IDs (LIDs) to track specific field units as they traverse different talkgroups. If an undercover unit switches from a Dispatch channel to a secure Tactical channel, their LID travels with them, allowing the tracking of a specific radio through the intelligence matrix.
*   **Network Stress Diagnostics:** Intercepts `SYS-BUSY` and `QUEUEDid` flags to visualize infrastructure bottlenecks and capacity failures. When a multi-million dollar dispatch system bucks under pressure during major incidents, BearSentinel audits their uptime and hardware constraints in real-time.
*   **ESK Bypass (EDACS Security Key):** M/A-COM aggressively marketed ESK as "encrypted" control infrastructure to lock down civilian listening. Modern Uniden scanners bypass ESK natively, proving it to be little more than an obfuscation physical mask. BearSentinel streams the plaintext data through the ESK illusion natively.
*   **Decrypted LCN Mapping:** The system never broadcasts the actual network radio frequencies over the air; it only broadcasts the arbitrary Logical Channel Numbers (LCN 1-25) abstracted from the radio template. BearSentinel aggressively captures and maps these localized abstractions instantly as voice channel drops are allocated.

---

## Zero-Install Execution

BearSentinel is built with **Vite + React + TypeScript** but compiled via `vite-plugin-singlefile`. This means the entirety of the styling, React framework, and application logic is bundled into one singular `.html` file without external dependency references.

To run BearSentinel:
1. Ensure you are using **Google Chrome** or **Microsoft Edge** (Safari and Firefox do not support the Web Serial API).
2. Simply double-click **`BearSentinel_v2.html`**. 
3. Click "Connect USB" and select your Uniden scanner's native serial port.

---

## Setup & Scanner Integration

In order for BearSentinel to receive the complex passive data payloads required for the EDACS telemetry, your Uniden BCD325p2 must be configured to output Extended Control Channel Information natively.

1. Connect the scanner to your PC using the mini-USB programming cable.
2. Ensure you have the Uniden serial drivers installed (Windows should do this automatically). 
3. On the scanner, navigate to **Settings -> C-CH Output**.
4. Set the **C-CH Output** mode to **`Extend`**. 
5. Tune the scanner to hold on the specific EDACS/SLERS Control Channel frequency you wish to monitor.

---

## Development

If you wish to modify the telemetry parsing engine (`src/core/Decoder.ts`), update the agency metadata mappings (`src/core/AgencyDB.ts`), or redesign the user interface, you will need Node.js installed.

```bash
# Clone the repository
git clone <repo-url>
cd BearSentinel

# Install dependencies
npm install

# Start the Vite development server with Hot Module Replacement
npm run dev
```

### Compiling to Single-File
Once you are satisfied with your modifications, you can compile the project back into the standalone `.html` bundle:

```bash
npm run build
# The resulting standalone file will be emitted to `dist/index.html` 
# You can manually rename and move this to replacing `BearSentinel_v2.html`
```
