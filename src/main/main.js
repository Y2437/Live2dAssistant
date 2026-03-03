require("dotenv").config();

const {ipcRegister}=require('./ipc/ipcRegister');

const fs = require('fs');
const path = require('path');
const {app,BrowserWindow,ipcMain} = require('electron');
const {wm} = require('./WindowManager.js');
const {WINDOW_MODE} = require('./config');


app.whenReady().then(async ()=>{
    //why TypeError: ipcRegister.registerAll is not a function ?
    await ipcRegister.registerAll();
    await wm.open("assistant");
    if(WINDOW_MODE === "devShell"){
        wm.get("assistant").webContents.openDevTools();
    }

})
app.on('window-all-closed', () => {
    wm.destroyAll();
    app.quit();
})
