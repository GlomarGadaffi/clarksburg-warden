import { useState, useEffect } from 'react';
import './App.css';
import { Serial } from './core/SerialMonitor';
import UnifiedDashboard from './pages/UnifiedDashboard';
import EDACSDashboard from './pages/EDACSDashboard';

function App() {
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<'UNIFIED' | 'EDACS'>('EDACS');
  const [time, setTime] = useState('--:--:--');

  useEffect(() => {
    Serial.onStatusChange(setConnected);
    const intv = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(intv);
  }, []);

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
        </div>
      </header>

      <main className="workspace">
        {view === 'EDACS' ? <EDACSDashboard /> : <UnifiedDashboard />}
      </main>

      <div className="status-bar">
        <div className="status-bar-left">
          <div className="stat-item"><span className="stat-label">MODE:</span> <span className="stat-val">{view}</span></div>
        </div>
        <div className="status-bar-right">
          <div className="stat-item"><span className="stat-label">POLL:</span> <span className="stat-val">150ms</span></div>
          <div className="stat-item"><span className="stat-label">BAUD:</span> <span className="stat-val">115200</span></div>
          <span>{time}</span>
        </div>
      </div>
    </div>
  );
}

export default App;
