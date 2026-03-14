const {WIDTH, HEIGHT, WINDOW_KEYS, WINDOW_FILE_MAP, WINDOW_MODE} = require('../config');
const path = require('path');
const {app,BrowserWindow,ipcMain} = require('electron');
class WindowManager{
    devMode = WINDOW_MODE === "devShell";
    independentWindows = new Set();
    constructor(){
        this.windows =new Map(WINDOW_KEYS.map((key)=>{return [key,null]}));
        this.defs=new Map(WINDOW_KEYS.map((key)=>{return [key,{
            config:{
                width: WIDTH,
                height:HEIGHT,
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation:true,
                    preload: path.join(__dirname, '../preload.js'),
                }
            },
            filePath: WINDOW_FILE_MAP[key]
        }
        ]}));
    }
    list(){
        let result=[];
        for(const item of this.windows.entries()){
            if(item[1]&&!item[1].isDestroyed()){
                result.push(item[0]);
            }
        }
        return result;
    }
    close(windowKey){
        const item=this.windows.get(windowKey);
        if(item&&!item.isDestroyed()){
            item.destroy();
        }
        this.windows.set(windowKey,null);
    }
    async open(windowKey){
        const selected=this.windows.get(windowKey);
        if(this.isDevMode() && !this.isIndependentWindow(windowKey)){
            let shell=this.windows.get("devShell");
            if(!shell){
                const created = await this.create("devShell");
                created.show();
                created.focus();
                shell=created;
            }else if(shell.isDestroyed()){
                this.windows.set("devShell",null);
                const created= await this.create("devShell");
                created.show();
                created.focus();
                shell=created;
            }else{
                shell.show();
                shell.focus();
            }
            shell.webContents.send('ui:showView',{viewKey:windowKey});

        }else{
            if(!selected){
                const created= await this.create(windowKey);
                created.show();
                created.focus();
                return;
            }
            if(selected.isDestroyed()){
                this.windows.set(windowKey,null);
                const created= await this.create(windowKey);
                created.show();
                created.focus();
                return;
            }
            if(!selected.isDestroyed()){
                selected.show();
                selected.focus();
            }
        }
    }
    get(windowKey){
        if(this.isDevMode() && !this.isIndependentWindow(windowKey)) windowKey="devShell";
        const selected=this.windows.get(windowKey);
        if(!selected){return null;}
        if(selected.isDestroyed()){return null;}
        return selected;
    }
    resolveWindowConfig(windowKey, baseConfig){
        return baseConfig;
    }
    async create(windowKey){
        const definition = this.defs.get(windowKey);
        const newWindow=new BrowserWindow(this.resolveWindowConfig(windowKey, definition.config));
        this.windows.set(windowKey,newWindow);
        await newWindow.loadFile(definition.filePath);
        newWindow.on('close',()=>{
            this.windows.set(windowKey,null);
        })
        return newWindow;
    }
    async toggle(windowKey){
        if(this.isDevMode() && !this.isIndependentWindow(windowKey)) windowKey="devShell";
        const selected=this.get(windowKey);
        if(!selected){
            await this.open(windowKey);
        }else{
            if(selected.isVisible()){
                selected.hide()
            }else{
                selected.show();
                selected.focus();
            }
        }
    }
    destroyAll(){
        for (const key of this.windows.keys()) {
            this.close(key);
        }
    }
    isDevMode(){
        return this.devMode;
    }
    isIndependentWindow(windowKey){
        return this.independentWindows.has(windowKey);
    }

}
const wm=new WindowManager();
module.exports = {wm};
