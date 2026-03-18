const PERF_PREFIX = "[perf]";
const PERF_STORAGE_KEY = "debug.perf.v1";
let perfEnabledCache = null;

function isPerfEnabled() {
    try {
        if (typeof window === "undefined") {
            return false;
        }
        if (window.__ENABLE_PERF_LOGS__ === true) {
            return true;
        }
        if (perfEnabledCache != null) {
            return perfEnabledCache;
        }
        perfEnabledCache = window.localStorage?.getItem(PERF_STORAGE_KEY) === "true";
        return perfEnabledCache;
    } catch (error) {
        // Ignore storage access errors.
        perfEnabledCache = false;
    }
    return false;
}

function nowMs() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
    }
    return Date.now();
}

function safeStringify(meta) {
    if (meta == null) {
        return "";
    }
    if (typeof meta === "string") {
        return meta;
    }
    try {
        return JSON.stringify(meta);
    } catch (error) {
        return String(meta);
    }
}

export function logPerf(label, durationMs, meta = null) {
    if (!isPerfEnabled()) {
        return;
    }
    const value = Number.isFinite(durationMs) ? durationMs.toFixed(2) : String(durationMs);
    const metaText = safeStringify(meta);
    if (metaText) {
        console.log(`${PERF_PREFIX} ${label} ${value}ms ${metaText}`);
        return;
    }
    console.log(`${PERF_PREFIX} ${label} ${value}ms`);
}

export function measureSync(label, fn, meta = null) {
    const start = nowMs();
    try {
        return fn();
    } finally {
        logPerf(label, nowMs() - start, meta);
    }
}

export async function measureAsync(label, fn, meta = null) {
    const start = nowMs();
    try {
        return await fn();
    } finally {
        logPerf(label, nowMs() - start, meta);
    }
}
