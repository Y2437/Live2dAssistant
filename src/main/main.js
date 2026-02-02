const {WIDTH, HEIGHT, WINDOW_KEYS} = require('./config');
const fs = require('fs');
const path = require('path');
const {app,BrowserWindow,ipcMain} = require('electron');
const {wm} = require('./WindowManager.js');
ipcMain.handle('app:ping',()=>{return "pong"})
ipcMain.handle("app:openWindow",async (event,windowKey)=>{
    if(!windowKey){
        throw new Error("Window key is missing!");
    }else if(typeof windowKey !== "string"){
        throw new Error("Window key is not a string!");
    }else if(!WINDOW_KEYS.includes(windowKey)){
        throw new Error("Invalid Window key!");
    }
    await wm.open(windowKey);
});

app.whenReady().then(async ()=>{
    await wm.open("assistant");
    wm.get("assistant").webContents.openDevTools();

})
app.on('window-all-closed', () => {
    wm.destroyAll();
    app.quit();
})
