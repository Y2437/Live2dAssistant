const {ipcRegister} = require("./ipc/ipcRegister");

const fs = require("fs");
const path = require("path");
const {app, globalShortcut} = require("electron");
const {wm} = require("./window/WindowManager.js");
const {WINDOW_MODE} = require("./config");
const {createQuickFloatSelectionCoordinator} = require("./quickFloat/selectionCoordinator");

let maintenanceTimer = null;
let quickFloatSelectionCoordinator = null;

const QUICK_FLOAT_SHORTCUT_CANDIDATES = [
    "CommandOrControl+Shift+Y",
    "CommandOrControl+Alt+Y",
    "CommandOrControl+Shift+J",
];
let activeQuickFloatShortcut = "";

app.disableHardwareAcceleration();

function configureElectronStoragePaths() {
    const userDataPath = app.getPath("userData");
    const tempCacheRoot = path.join(app.getPath("temp"), "live2dassistant-cache");
    const sessionDataPath = path.join(userDataPath, "SessionData");
    const cachePath = path.join(tempCacheRoot, "Cache");
    const gpuCachePath = path.join(cachePath, "GPUCache");
    fs.mkdirSync(sessionDataPath, {recursive: true});
    fs.mkdirSync(cachePath, {recursive: true});
    fs.mkdirSync(gpuCachePath, {recursive: true});
    app.setPath("sessionData", sessionDataPath);
    app.setPath("cache", cachePath);
    app.commandLine.appendSwitch("disk-cache-dir", cachePath);
    app.commandLine.appendSwitch("media-cache-dir", cachePath);
    app.commandLine.appendSwitch("disable-http-cache");
    app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
    app.commandLine.appendSwitch("disk-cache-size", "1");
}

function registerQuickFloatToggleShortcut(handler) {
    for (const accelerator of QUICK_FLOAT_SHORTCUT_CANDIDATES) {
        const ok = globalShortcut.register(accelerator, handler);
        if (ok) {
            activeQuickFloatShortcut = accelerator;
            return accelerator;
        }
    }
    return "";
}

configureElectronStoragePaths();

async function runBackgroundMaintenance() {
    try {
        await ipcRegister.maybeRunDailyMemoryExtraction();
    } catch (error) {
        console.warn("[maintenance] memory extraction failed:", error?.message || error);
    }
}

app.whenReady().then(async () => {
    await ipcRegister.registerAll();
    quickFloatSelectionCoordinator = createQuickFloatSelectionCoordinator({wm, ipcRegister});
    maintenanceTimer = setInterval(() => {
        runBackgroundMaintenance().catch((error) => {
            console.warn("[maintenance] unexpected error:", error?.message || error);
        });
    }, 60 * 60 * 1000);

    await wm.open("assistant");

    const registeredShortcut = registerQuickFloatToggleShortcut(async () => {
        const enabled = ipcRegister.toggleQuickFloatFeatureEnabled();
        if (!enabled) {
            quickFloatSelectionCoordinator?.stop();
            quickFloatSelectionCoordinator?.closeQuickFloatWindow();
        } else {
            quickFloatSelectionCoordinator?.resetFingerprint();
            quickFloatSelectionCoordinator?.start();
            await quickFloatSelectionCoordinator?.monitorSelectionAndTriggerQuickFloat();
        }

        quickFloatSelectionCoordinator?.notifyFeatureToggled(enabled);
        console.log(`[quick-float] feature ${enabled ? "enabled" : "disabled"} via ${activeQuickFloatShortcut || "unknown"}`);
    });

    if (!registeredShortcut) {
        console.warn(`[shortcut] register failed: ${QUICK_FLOAT_SHORTCUT_CANDIDATES.join(", ")}`);
    } else {
        console.log(`[shortcut] registered: ${registeredShortcut}`);
    }

    if (WINDOW_MODE === "devShell") {
        wm.get("assistant").webContents.openDevTools();
    }
    quickFloatSelectionCoordinator?.start();
});

app.on("window-all-closed", () => {
    if (maintenanceTimer) {
        clearInterval(maintenanceTimer);
        maintenanceTimer = null;
    }
    wm.destroyAll();
    app.quit();
});

app.on("will-quit", () => {
    quickFloatSelectionCoordinator?.stop();
    globalShortcut.unregisterAll();
});
