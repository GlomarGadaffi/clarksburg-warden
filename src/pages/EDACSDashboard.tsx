import { useState } from 'react';
import GrantFeed from '../components/GrantFeed';
import PatchMatrix from '../components/PatchMatrix';
import Leaderboard from '../components/Leaderboard';
import LCNMap from '../components/LCNMap';
import './EDACSDashboard.css';

export default function EDACSDashboard() {
    const [view, setView] = useState<'LEADERBOARD' | 'LCN'>('LEADERBOARD');

    return (
        <div className="edacs-dashboard">
            <GrantFeed />
            <div className="edacs-right-panel">
                <PatchMatrix />
                <div className="edacs-toggle-bar">
                    <button 
                        className={view === 'LEADERBOARD' ? 'active' : ''} 
                        onClick={() => setView('LEADERBOARD')}
                    >
                        Leaderboard
                    </button>
                    <button 
                        className={view === 'LCN' ? 'active' : ''} 
                        onClick={() => setView('LCN')}
                    >
                        Auto-LCN Map
                    </button>
                </div>
                {view === 'LEADERBOARD' ? <Leaderboard /> : <LCNMap />}
            </div>
        </div>
    );
}
