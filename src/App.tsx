import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { Serial } from './core/SerialMonitor';
import UnifiedDashboard from './pages/UnifiedDashboard';
import EDACSDashboard from './pages/EDACSDashboard';
import ExportButton from './components/ExportButton';
import RawLogDrawer from './components/RawLogDrawer';
import { SentinelContext, defaultStore, useSentinelState, useSentinelStore } from './core/useSentinel';
import { Usb, Unplug, Trash2, Terminal } from 'lucide-react';

function AppContent() {
  const store = useSentinelStore();
  const { stats } = useSentinelState();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [view, setView] = useState<'UNIFIED' | 'EDACS'>('EDACS');
  const [time, setTime] = useState('--:--:--');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uptimeStr, setUptimeStr] = useState('0h 0m');

  useEffect(() => {
    const unsub = Serial.onStatusChange(setConnected);
    const intv = setInterval(() => {
        setTime(new Date().toLocaleTimeString());
        const uptimeMs = Date.now() - stats.sessionStart;
        const hrs = Math.floor(uptimeMs / 3600000);
        const mins = Math.floor((uptimeMs % 3600000) / 60000);
        setUptimeStr(`${hrs}h ${mins}m`);
    }, 1000);
    return () => { unsub(); clearInterval(intv); };
  }, [stats.sessionStart]);

  const handleConnect = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      if (!connected) await Serial.connect();
      else await Serial.disconnect();
    } finally {
      setConnecting(false);
    }
  }, [connected, connecting]);

  const handleToggleDrawer = useCallback(() => {
    setDrawerOpen(prev => !prev);
  }, []);

  const connectBtnClass = connecting
    ? 'hdr-btn btn-connecting'
    : connected
      ? 'hdr-btn btn-disconnect'
      : 'hdr-btn btn-connect';

  const connectLabel = connecting ? 'Connecting…' : connected ? 'Disconnect' : 'Connect USB';
  const ConnectIcon = connecting ? Usb : connected ? Unplug : Usb;

  return (
    <div className="app-container">
      <header>
        <div className="brand">
          <span className="brand-mark">Sentinel</span>
          <div className="brand-divider" aria-hidden="true"></div>
          <div className="brand-systems" role="tablist" aria-label="Dashboard view">
            <button
              role="tab"
              aria-selected={view === 'EDACS'}
              className={`sys-tab slers ${view === 'EDACS' ? 'active' : ''}`}
              onClick={() => setView('EDACS')}
            >
              EDACS Exclusive
            </button>
            <button
              role="tab"
              aria-selected={view === 'UNIFIED'}
              className={`sys-tab p25 ${view === 'UNIFIED' ? 'active' : ''}`}
              onClick={() => setView('UNIFIED')}
            >
              Unified (EDACS+P25)
            </button>
          </div>
        </div>
        <div className="header-controls">
          <div
            className={`conn-indicator ${connected ? 'live' : ''}`}
            aria-label={connected ? 'Scanner connected' : 'Scanner offline'}
            role="status"
          >
            <span className="conn-dot" aria-hidden="true"></span>
            <span>{connected ? 'CONNECTED' : 'OFFLINE'}</span>
          </div>
          <button
            className={connectBtnClass}
            onClick={handleConnect}
            disabled={connecting}
            aria-label={connectLabel}
          >
            <ConnectIcon size={12} aria-hidden="true" />
            {connectLabel}
          </button>
          <ExportButton />
          <button
            className="hdr-btn btn-wipe"
            onClick={() => store.wipeDB()}
            aria-label="Wipe database"
          >
            <Trash2 size={12} aria-hidden="true" />
            Wipe DB
          </button>
        </div>
      </header>

      <main className="workspace" role="main">
        {view === 'EDACS' ? <EDACSDashboard /> : <UnifiedDashboard />}
      </main>

      <RawLogDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="status-bar" role="contentinfo">
        <div className="status-bar-left">
          <div className="stat-item">
            <span className="stat-label">PATCHES:</span>
            <span className="stat-val" aria-live="polite">{stats.patches}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">GRANTS:</span>
            <span className="stat-val" aria-live="polite">{stats.grants}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">P25 HITS:</span>
            <span className="stat-val" aria-live="polite">{stats.p25Total}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">UPTIME:</span>
            <span className="stat-val">{uptimeStr}</span>
          </div>
        </div>
        <div className="status-bar-right">
          <button
            className={`raw-log-toggle ${drawerOpen ? 'active' : ''}`}
            onClick={handleToggleDrawer}
            aria-expanded={drawerOpen}
            aria-controls="raw-log-drawer"
          >
            <Terminal size={10} aria-hidden="true" />
            {drawerOpen ? 'HIDE RAW' : 'SHOW RAW'}
          </button>
          <div className="short-divider" aria-hidden="true"></div>
          <div className="stat-item">
            <span className="stat-label">POLL:</span>
            <span className="stat-val">150ms</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">BAUD:</span>
            <span className="stat-val">115200</span>
          </div>
          <span aria-label={`Current time ${time}`}>{time}</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
    return (
        <SentinelContext.Provider value={defaultStore}>
            <AppContent />
        </SentinelContext.Provider>
    );
}
