const {ipcMain} = require('electron');
const {aiChat} = require('./aiService.js');
const fs = require("fs/promises");
const {wm} = require("../WindowManager");
const {WIDTH, HEIGHT, WINDOW_KEYS,AI_CHAT_SYSTEM_PROMPT,AI_TOUCH_RESPONSE, POMODORO_JSON_PATH} = require('../config');
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
    static registerTouchResponse(){
        ipcMain.handle("app:touch",async (event,name)=>{
            const totalNum=AI_TOUCH_RESPONSE[name].response.length;
            const selectedNum=Math.floor(Math.random() * (totalNum));
            return AI_TOUCH_RESPONSE[name].response[selectedNum].content;
        })
    }
    static async ensurePomodoroJsonExists(dataPath){
        return JSON.parse(await fs.readFile(dataPath,"utf8"));
    }
    static async ensurePomodoroJson(dataPath){
        try{
            return await this.ensurePomodoroJsonExists(dataPath);
        }catch(err){
            if(err.code === "ENOENT"){
                await fs.writeFile(dataPath,"[]","utf-8");
                return [];
            }else throw err;
        }

    }

    // app.whenReady().then(() => {
    //     path = require("path");
    //     dataPath=path.join(app.getPath("userData"),"todo.json");
    //     mainWindow= createWindow({width: WIDTH, height: HEIGHT});
    //     mainWindow.loadFile(path.join(__dirname, "index.html"));
    //     mainWindow.webContents.openDevTools();
    //
    //
    //     ipcMain.handle("todo:save",async (event,data)=>{
    //         let saveData = JSON.stringify(data, null, 2);
    //         return fs.writeFile(dataPath,saveData);
    //     });
    //     ipcMain.handle("todo:load",async (event)=>{
    //         return await ensureTodoFile(dataPath);
    //     })
    //
    // })
    static registerPomodoroJson(){
        ipcMain.handle("app:loadPomodoroJson",async (event)=>{
            return await this.ensurePomodoroJson(POMODORO_JSON_PATH);
        })
        ipcMain.handle("app:savePomodoroJson",async (event,data)=>{
            return await fs.writeFile(POMODORO_JSON_PATH,JSON.stringify(data,null,2));
        })
    }

    static registerAll(){
        this.registerOpenWindow();
        this.registerPing();
        this.registerAiChat();
        this.registerTouchResponse();
        this.registerPomodoroJson();
    }

}
module.exports = {ipcRegister};