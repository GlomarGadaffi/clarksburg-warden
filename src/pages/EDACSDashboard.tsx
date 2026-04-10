import GrantFeed from '../components/GrantFeed';
import PatchMatrix from '../components/PatchMatrix';
import Leaderboard from '../components/Leaderboard';
import './EDACSDashboard.css';

export default function EDACSDashboard() {
    return (
        <div className="edacs-dashboard">
            <GrantFeed />
            <div className="edacs-right-panel">
                <PatchMatrix />
                <Leaderboard />
            </div>
        </div>
    );
}
