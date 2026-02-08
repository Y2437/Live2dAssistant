const {ipcMain} = require('electron');
const {aiChat} = require('./aiService.js');
const {wm} = require("../WindowManager");
const {WIDTH, HEIGHT, WINDOW_KEYS,AI_CHAT_SYSTEM_PROMPT} = require('../config');
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
    static registerAiChat(){
        ipcMain.handle("app:aiChat",async (event,message)=>{
            const  aiChatMessage =[
                {role:"system",message:AI_CHAT_SYSTEM_PROMPT},
                {role:"user",message:message},
            ]
            return await aiChat(aiChatMessage);
        })
    }
    static registerAll(){
        this.registerOpenWindow();
        this.registerPing();
        this.registerAiChat();
    }
}
module.exports = {ipcRegister};