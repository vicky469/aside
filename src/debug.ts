const DEBUG_STORAGE_KEY = "sidenote2:debug";
const MAX_DEBUG_EVENTS = 100;

export interface DebugEventEntry {
    at: string;
    event: string;
    payload?: unknown;
}

export interface DebugStore {
    enabled: boolean;
    counts: Record<string, number>;
    events: DebugEventEntry[];
}

declare global {
    interface Window {
        __SIDENOTE2_DEBUG__?: boolean;
        __SIDENOTE2_DEBUG_STORE__?: DebugStore;
    }
}

function getWindowRef(): Window | null {
    return typeof window === "undefined" ? null : window;
}

function readPersistedDebugFlag(win: Window): boolean {
    try {
        return win.localStorage.getItem(DEBUG_STORAGE_KEY) === "true";
    } catch {
        return false;
    }
}

function ensureDebugStore(win: Window): DebugStore {
    if (!win.__SIDENOTE2_DEBUG_STORE__) {
        win.__SIDENOTE2_DEBUG_STORE__ = {
            enabled: false,
            counts: {},
            events: [],
        };
    }
    return win.__SIDENOTE2_DEBUG_STORE__;
}

export function initializeDebug(): DebugStore | null {
    const win = getWindowRef();
    if (!win) {
        return null;
    }

    if (typeof win.__SIDENOTE2_DEBUG__ !== "boolean") {
        win.__SIDENOTE2_DEBUG__ = readPersistedDebugFlag(win);
    }

    const store = ensureDebugStore(win);
    store.enabled = win.__SIDENOTE2_DEBUG__ === true;
    return store;
}

export function isDebugEnabled(): boolean {
    const win = getWindowRef();
    if (!win) {
        return false;
    }

    if (typeof win.__SIDENOTE2_DEBUG__ === "boolean") {
        return win.__SIDENOTE2_DEBUG__ === true;
    }

    return readPersistedDebugFlag(win);
}

export function setDebugEnabled(enabled: boolean): void {
    const win = getWindowRef();
    if (!win) {
        return;
    }

    win.__SIDENOTE2_DEBUG__ = enabled;
    try {
        if (enabled) {
            win.localStorage.setItem(DEBUG_STORAGE_KEY, "true");
        } else {
            win.localStorage.removeItem(DEBUG_STORAGE_KEY);
        }
    } catch {
        // Ignore localStorage failures; in-memory debug still works.
    }

    const store = ensureDebugStore(win);
    store.enabled = enabled;
}

export function clearDebugStore(): void {
    const win = getWindowRef();
    if (!win) {
        return;
    }

    const store = ensureDebugStore(win);
    store.counts = {};
    store.events = [];
    store.enabled = isDebugEnabled();
}

export function debugLog(event: string, payload?: unknown): void {
    if (!isDebugEnabled()) {
        return;
    }

    const win = getWindowRef();
    if (!win) {
        return;
    }

    const store = ensureDebugStore(win);
    store.enabled = true;
    store.events.push({
        at: new Date().toISOString(),
        event,
        payload,
    });
    if (store.events.length > MAX_DEBUG_EVENTS) {
        store.events.splice(0, store.events.length - MAX_DEBUG_EVENTS);
    }

    if (payload === undefined) {
        console.log(`[SideNote2] ${event}`);
    } else {
        console.log(`[SideNote2] ${event}`, payload);
    }
}

export function debugCount(label: string): number {
    if (!isDebugEnabled()) {
        return 0;
    }

    const win = getWindowRef();
    if (!win) {
        return 0;
    }

    const store = ensureDebugStore(win);
    store.enabled = true;
    const next = (store.counts[label] || 0) + 1;
    store.counts[label] = next;
    console.log(`[SideNote2] ${label} #${next}`);
    return next;
}
