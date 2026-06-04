// Vitest setup: guarantee a fully-functional localStorage in the test
// environment. jsdom's built-in Storage can be flaky depending on the Node
// version (the `--localstorage-file` warning / missing `clear` method), so we
// install a deterministic in-memory implementation that the store relies on.
import { beforeEach } from 'vitest';

class MemoryStorage implements Storage {
    private map = new Map<string, string>();

    get length(): number {
        return this.map.size;
    }
    clear(): void {
        this.map.clear();
    }
    getItem(key: string): string | null {
        return this.map.has(key) ? this.map.get(key)! : null;
    }
    key(index: number): string | null {
        return Array.from(this.map.keys())[index] ?? null;
    }
    removeItem(key: string): void {
        this.map.delete(key);
    }
    setItem(key: string, value: string): void {
        this.map.set(key, String(value));
    }
}

const storage = new MemoryStorage();

Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
});

// Always start each test with empty storage so persistence state never leaks.
beforeEach(() => {
    storage.clear();
});
