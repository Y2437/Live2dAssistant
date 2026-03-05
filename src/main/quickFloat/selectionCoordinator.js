const {screen, BrowserWindow} = require("electron");

const QUICK_FLOAT_MONITOR_INTERVAL = 120;

function buildSelectionFingerprint(text = "") {
    return String(text || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function resolveAnchorPoint(anchorPoint = null) {
    if (anchorPoint && Number.isFinite(Number(anchorPoint.x)) && Number.isFinite(Number(anchorPoint.y))) {
        return {x: Number(anchorPoint.x), y: Number(anchorPoint.y)};
    }
    return screen.getCursorScreenPoint();
}

function positionQuickFloatNearAnchor(windowInstance, anchorPoint = null) {
    if (!windowInstance || windowInstance.isDestroyed()) {
        return;
    }
    const anchor = resolveAnchorPoint(anchorPoint);
    const display = screen.getDisplayNearestPoint(anchor);
    const workArea = display?.workArea || {x: 0, y: 0, width: 1920, height: 1080};
    const [width, height] = windowInstance.getSize();
    const gap = 8;
    let x = anchor.x + gap;
    let y = anchor.y + gap;
    if (x + width > workArea.x + workArea.width) {
        x = anchor.x - width - gap;
    }
    if (y + height > workArea.y + workArea.height) {
        y = anchor.y - height - gap;
    }
    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width));
    y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height));
    windowInstance.setPosition(Math.round(x), Math.round(y), true);
}

function createQuickFloatSelectionCoordinator({wm, ipcRegister}) {
    let selectionMonitorTimer = null;
    let selectionInFlight = false;
    let lastSelectionFingerprint = "";

    async function emitSelectionToQuickFloat(payload) {
        if (!payload?.text) {
            return;
        }
        const existingWindow = wm.get("quickFloat");
        const shouldReposition = !(existingWindow && !existingWindow.isDestroyed() && existingWindow.isVisible());
        await wm.open("quickFloat");
        const quickFloatWindow = wm.get("quickFloat");
        if (!quickFloatWindow || quickFloatWindow.isDestroyed()) {
            return;
        }
        if (shouldReposition) {
            positionQuickFloatNearAnchor(quickFloatWindow, payload?.anchor || null);
        }
        quickFloatWindow.webContents.send("quick-float:selection-ready", {
            text: payload.text,
            source: payload.source || "selection",
            anchor: payload?.anchor || null,
            capturedAt: new Date().toISOString(),
        });
    }

    async function monitorSelectionAndTriggerQuickFloat() {
        if (!ipcRegister.getQuickFloatFeatureEnabled()) {
            return;
        }
        if (selectionInFlight) {
            return;
        }
        const focusedWindow = BrowserWindow.getFocusedWindow();
        const quickFloatWindow = wm.get("quickFloat");
        if (quickFloatWindow && focusedWindow && focusedWindow === quickFloatWindow) {
            return;
        }
        selectionInFlight = true;
        try {
            const payload = await ipcRegister.captureSelectedTextFromUiAutomation();
            const text = String(payload?.text || "").trim();
            if (!text) {
                lastSelectionFingerprint = "";
                if (quickFloatWindow && !quickFloatWindow.isDestroyed() && quickFloatWindow.isVisible()) {
                    const interacting = quickFloatWindow.__quickFloatInteracting === true;
                    const focusedOnQuickFloat = BrowserWindow.getFocusedWindow() === quickFloatWindow;
                    if (!interacting && !focusedOnQuickFloat) {
                        closeQuickFloatWindow();
                    }
                }
                return;
            }
            const fingerprint = buildSelectionFingerprint(text);
            if (!fingerprint || fingerprint === lastSelectionFingerprint) {
                return;
            }
            lastSelectionFingerprint = fingerprint;
            await emitSelectionToQuickFloat(payload);
        } catch (error) {
            // silent
        } finally {
            selectionInFlight = false;
        }
    }

    function stop() {
        if (selectionMonitorTimer) {
            clearInterval(selectionMonitorTimer);
            selectionMonitorTimer = null;
        }
    }

    function start() {
        stop();
        if (!ipcRegister.getQuickFloatFeatureEnabled()) {
            return;
        }
        selectionMonitorTimer = setInterval(() => {
            monitorSelectionAndTriggerQuickFloat().catch(() => {});
        }, QUICK_FLOAT_MONITOR_INTERVAL);
    }

    function resetFingerprint() {
        lastSelectionFingerprint = "";
    }

    function closeQuickFloatWindow() {
        const quickFloatWindow = wm.get("quickFloat");
        if (quickFloatWindow && !quickFloatWindow.isDestroyed()) {
            quickFloatWindow.close();
        }
    }

    function notifyFeatureToggled(enabled) {
        const quickFloatWindow = wm.get("quickFloat");
        if (quickFloatWindow && !quickFloatWindow.isDestroyed()) {
            quickFloatWindow.webContents.send("quick-float:feature-toggled", {enabled});
        }
    }

    return {
        start,
        stop,
        resetFingerprint,
        monitorSelectionAndTriggerQuickFloat,
        closeQuickFloatWindow,
        notifyFeatureToggled,
    };
}

module.exports = {
    createQuickFloatSelectionCoordinator,
};
