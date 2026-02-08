const {ipcMain} = require('electron');
const {wm} = require("../WindowManager");
const {WIDTH, HEIGHT, WINDOW_KEYS} = require('../config');
class ipcRegister{
    constructor(ipc){
    }
    static registerPing(){
        ipcMain.handle('app:ping',()=>{return "pong"})
    }
    static registerOpenWindow(){
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
    }
    static registerAll(){
        this.registerOpenWindow();
        this.registerPing();
    }
}
module.exports = {ipcRegister};