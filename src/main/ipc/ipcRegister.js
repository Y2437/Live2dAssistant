const {ipcMain} = require('electron');
const {aiChat} = require('./aiService.js');
const fs = require("fs/promises");
const {wm} = require("../WindowManager");
const {WIDTH, HEIGHT, WINDOW_KEYS,AI_CHAT_SYSTEM_PROMPT,AI_TOUCH_RESPONSE, POMODORO_JSON_PATH, AI_CONTEXT_JSON_PATH, AI_LONG_TERM_MEMORY_JSON_PATH} = require('../config');
class ipcRegister{
    static assistantContext = [];
    static assistantLongTermMemory = [];
    static MAX_CONTEXT_MESSAGES = 16;
    constructor(ipc){
    }
    static buildAiChatMessages(message){
        return [
            {role:"system",message:AI_CHAT_SYSTEM_PROMPT},
            ...this.assistantContext,
            {role:"user",message},
        ];
    }
    static trimAssistantContext(){
        if(this.assistantContext.length <= this.MAX_CONTEXT_MESSAGES){
            return;
        }
        this.assistantContext = this.assistantContext.slice(-this.MAX_CONTEXT_MESSAGES);
    }
    static normalizeAssistantContext(data){
        if(!Array.isArray(data)){
            return [];
        }
        return data.filter((item)=>{
            return item
                && (item.role === "user" || item.role === "assistant")
                && typeof item.message === "string"
                && item.message.trim() !== "";
        }).map((item)=>({role:item.role,message:item.message}));
    }
    static async saveAssistantContext(){
        await fs.writeFile(AI_CONTEXT_JSON_PATH, JSON.stringify(this.assistantContext, null, 2), "utf-8");
    }
    static async loadAssistantContext(){
        try{
            const raw = await fs.readFile(AI_CONTEXT_JSON_PATH, "utf8");
            this.assistantContext = this.normalizeAssistantContext(JSON.parse(raw));
            this.trimAssistantContext();
        }catch(err){
            if(err.code === "ENOENT"){
                this.assistantContext = [];
                await this.saveAssistantContext();
                return;
            }
            throw err;
        }
    }
    static normalizeLongTermMemory(data){
        if(!Array.isArray(data)){
            return [];
        }
        return data.filter((item)=>{
            return item
                && typeof item.title === "string"
                && item.title.trim() !== ""
                && typeof item.content === "string";
        }).map((item)=>({
            id: item.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title: item.title,
            content: item.content,
            source: typeof item.source === "string" ? item.source : "manual",
            updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
        }));
    }
    static async saveLongTermMemory(){
        await fs.writeFile(AI_LONG_TERM_MEMORY_JSON_PATH, JSON.stringify(this.assistantLongTermMemory, null, 2), "utf-8");
    }
    static async loadLongTermMemory(){
        try{
            const raw = await fs.readFile(AI_LONG_TERM_MEMORY_JSON_PATH, "utf8");
            this.assistantLongTermMemory = this.normalizeLongTermMemory(JSON.parse(raw));
        }catch(err){
            if(err.code === "ENOENT"){
                this.assistantLongTermMemory = [];
                await this.saveLongTermMemory();
                return;
            }
            throw err;
        }
    }
    static getAssistantContextMeta(){
        return {
            messageCount: this.assistantContext.length,
        };
    }
    static getAssistantContextData(){
        return {
            messageCount: this.assistantContext.length,
            items: this.assistantContext,
        };
    }
    static getLongTermMemoryData(){
        return {
            memoryCount: this.assistantLongTermMemory.length,
            items: this.assistantLongTermMemory,
        };
    }
    static getAssistantReplyContent(response){
        return response?.choices?.[0]?.message?.content ?? "";
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
            const aiChatMessage = this.buildAiChatMessages(message);
            const response = await aiChat(aiChatMessage);
            const assistantReply = this.getAssistantReplyContent(response);

            this.assistantContext.push({role:"user",message});
            if(assistantReply){
                this.assistantContext.push({role:"assistant",message:assistantReply});
            }
            this.trimAssistantContext();
            await this.saveAssistantContext();
            return response;
        })
    }
    static registerAiContextManager(){
        ipcMain.handle("app:getAiContextMeta",async ()=>{
            return this.getAssistantContextMeta();
        });
        ipcMain.handle("app:getAiContextData",async ()=>{
            return this.getAssistantContextData();
        });
        ipcMain.handle("app:clearAiContext",async ()=>{
            this.assistantContext = [];
            await this.saveAssistantContext();
            return this.getAssistantContextMeta();
        });
        ipcMain.handle("app:getLongTermMemoryData",async ()=>{
            return this.getLongTermMemoryData();
        });
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

    static async registerAll(){
        await this.loadAssistantContext();
        await this.loadLongTermMemory();
        this.registerOpenWindow();
        this.registerPing();
        this.registerAiChat();
        this.registerAiContextManager();
        this.registerTouchResponse();
        this.registerPomodoroJson();
    }

}
module.exports = {ipcRegister};
