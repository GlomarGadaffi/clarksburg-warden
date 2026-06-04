import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { SentinelStore } from './SentinelStore';

export const defaultStore = new SentinelStore();
export const SentinelContext = createContext<SentinelStore>(defaultStore);

export function useSentinelStore() {
    return useContext(SentinelContext);
}

export function useSentinelState() {
    const store = useSentinelStore();
    useSyncExternalStore(store.subscribe, store.getSnapshot);
    return store;
}

/**
 * Returns a wall-clock timestamp that updates on an interval, so components can
 * render relative ages ("12s ago") without calling the impure `Date.now()` in
 * the render body (which React's purity rules forbid).
 */
export function useNow(intervalMs = 1000) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}
