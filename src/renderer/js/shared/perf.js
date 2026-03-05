const PERF_PREFIX = "[perf]";

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

