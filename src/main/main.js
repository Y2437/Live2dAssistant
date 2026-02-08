const {ipcRegister}=require('./ipc/ipcRegister');

const fs = require('fs');
const path = require('path');
const {app,BrowserWindow,ipcMain} = require('electron');
const {wm} = require('./WindowManager.js');


app.whenReady().then(async ()=>{
    //why TypeError: ipcRegister.registerAll is not a function ?
    ipcRegister.registerAll();
    await wm.open("assistant");
    wm.get("assistant").webContents.openDevTools();

})
app.on('window-all-closed', () => {
    wm.destroyAll();
    app.quit();
})
