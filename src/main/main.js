const WIDTH = 800;
const HEIGHT = 600;


const fs = require('fs');
const path = require('path');
const {app,BrowserWindow,ipcMain} = require('electron');
const {wm} = require('./WindowManager.js');
ipcMain.handle('app:ping',()=>{return "pong"})
ipcMain.handle("app:openWindow",async (event,windowKey)=>{return "OK!"+windowKey;});

app.whenReady().then(async ()=>{
    await wm.open("devShell");
    wm.get("devShell").webContents.openDevTools();

})
app.on('window-all-closed', () => {
    wm.destroyAll();
    app.quit();
})
