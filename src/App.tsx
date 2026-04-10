import { useState, useEffect } from 'react';
import './App.css';
import { Serial } from './core/SerialMonitor';
import UnifiedDashboard from './pages/UnifiedDashboard';
import EDACSDashboard from './pages/EDACSDashboard';
import ExportButton from './components/ExportButton';
import RawLogDrawer from './components/RawLogDrawer';
import { SentinelContext, defaultStore, useSentinelState, useSentinelStore } from './core/useSentinel';

function AppContent() {
  const store = useSentinelStore();
  const { stats } = useSentinelState();
  const [connected, setConnected] = useState(false);
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

  const handleConnect = async () => {
    if (!connected) await Serial.connect();
    else await Serial.disconnect();
  };

  return (
    <div className="app-container">
      <header>
        <div className="brand">
          <span className="brand-mark">Sentinel</span>
          <div className="brand-divider"></div>
          <div className="brand-systems">
            <span 
              className={`sys-tag slers ${view === 'EDACS' ? 'active' : ''}`}
              onClick={() => setView('EDACS')}
            >
              EDACS EXCLUSIVE
            </span>
            <span 
              className={`sys-tag p25 ${view === 'UNIFIED' ? 'active' : ''}`}
              onClick={() => setView('UNIFIED')}
            >
              UNIFIED (EDACS+P25)
            </span>
          </div>
        </div>
        <div className="header-controls">
          <div className={`conn-indicator ${connected ? 'live' : ''}`}>
            <span className="conn-dot"></span>
            <span>{connected ? 'CONNECTED' : 'OFFLINE'}</span>
          </div>
          <button 
            className={`hdr-btn ${connected ? 'btn-disconnect' : 'btn-connect'}`} 
            onClick={handleConnect}
          >
            {connected ? 'Disconnect' : 'Connect USB'}
          </button>
          <ExportButton />
          <button className="hdr-btn btn-wipe" onClick={() => store.wipeDB()}>Wipe DB</button>
        </div>
      </header>

      <main className="workspace">
        {view === 'EDACS' ? <EDACSDashboard /> : <UnifiedDashboard />}
      </main>

      <RawLogDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="status-bar">
        <div className="status-bar-left">
          <div className="stat-item"><span className="stat-label">PATCHES:</span> <span className="stat-val">{stats.patches}</span></div>
          <div className="stat-item"><span className="stat-label">GRANTS:</span> <span className="stat-val">{stats.grants}</span></div>
          <div className="stat-item"><span className="stat-label">P25 HITS:</span> <span className="stat-val">{stats.p25Total}</span></div>
          <div className="stat-item"><span className="stat-label">UPTIME:</span> <span className="stat-val">{uptimeStr}</span></div>
        </div>
        <div className="status-bar-right">
          <button className="raw-log-toggle" onClick={() => setDrawerOpen(!drawerOpen)}>
            {drawerOpen ? 'HIDE RAW' : 'SHOW RAW'}
          </button>
          <div className="brand-divider short-divider"></div>
          <div className="stat-item"><span className="stat-label">POLL:</span> <span className="stat-val">150ms</span></div>
          <div className="stat-item"><span className="stat-label">BAUD:</span> <span className="stat-val">115200</span></div>
          <span>{time}</span>
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
