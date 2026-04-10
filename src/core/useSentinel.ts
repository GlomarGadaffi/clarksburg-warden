import { createContext, useContext, useSyncExternalStore } from 'react';
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
