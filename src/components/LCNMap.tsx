import { useSentinelState } from '../core/useSentinel';
import { Database } from 'lucide-react';
import './LCNMap.css';

export default function LCNMap() {
    const { lcnMap } = useSentinelState();
    
    // Sort LCNs numerically
    const sortedLcns = Array.from(lcnMap.entries()).sort((a, b) => {
        return parseInt(a[0], 16) - parseInt(b[0], 16);
    });

    const decodeVC = (hex: string) => {
        // Uniden EDACS VC payload decoding
        // If it's a raw serial representation of the frequency, we format it.
        // As EDACS scanners often output the raw OSW or an internal frequency representation,
        // we provide the raw payload here for diagnostic matching against the site license.
        return `0x${hex}`;
    };

    return (
        <div className="lcn-section">
            <div className="lcn-head">
                <span>Site LCN Map (Auto-Discovered)</span>
                <div className="lcn-cols"><span>LCN #</span><span>VC Payload</span></div>
            </div>
            <div className="lcn-list">
                {sortedLcns.length === 0 && <div className="lcn-empty">Awaiting voice grants to map LCNs...</div>}
                {sortedLcns.map(([lcn, vc]) => (
                    <div key={lcn} className="lcn-row">
                        <div className="lcn-label">
                            <Database size={10} style={{ opacity: 0.5, marginRight: '6px' }} />
                            <span className="lcn-id">LCN {parseInt(lcn, 16)}</span>
                        </div>
                        <div className="lcn-val">
                            <span>{decodeVC(vc)}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
