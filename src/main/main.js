const {ipcRegister}=require('./ipc/ipcRegister');

const fs = require('fs');
const path = require('path');
const {app,BrowserWindow,ipcMain} = require('electron');
const {wm} = require('./window/WindowManager.js');
const {WINDOW_MODE} = require('./config');

let maintenanceTimer = null;

async function runBackgroundMaintenance() {
    try {
        await ipcRegister.maybeRunDailyMemoryExtraction();
    } catch (error) {
        console.warn("[maintenance] memory extraction failed:", error?.message || error);
    }

    try {
        if (ipcRegister.agentService) {
            await ipcRegister.agentService.rebuildLibraryIndex();
        }
    } catch (error) {
        console.warn("[maintenance] library index rebuild failed:", error?.message || error);
    }
}

app.whenReady().then(async ()=>{
    //why TypeError: ipcRegister.registerAll is not a function ?
    await ipcRegister.registerAll();
    maintenanceTimer = setInterval(() => {
        runBackgroundMaintenance().catch((error) => {
            console.warn("[maintenance] unexpected error:", error?.message || error);
        });
    }, 60 * 60 * 1000);
    await wm.open("assistant");
    if(WINDOW_MODE === "devShell"){
        wm.get("assistant").webContents.openDevTools();
    }

})
app.on('window-all-closed', () => {
    if(maintenanceTimer){
        clearInterval(maintenanceTimer);
        maintenanceTimer = null;
    }
    wm.destroyAll();
    app.quit();
})
