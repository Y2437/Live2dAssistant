const {WIDTH, HEIGHT, WINDOW_KEYS} = require('./config');
const path = require('path');
const {app,BrowserWindow,ipcMain} = require('electron');
class WindowManager{
    devMode = true;
    constructor(){
        this.windows =new Map(WINDOW_KEYS.map((key)=>{return [key,null]}));
        this.defs=new Map(WINDOW_KEYS.map((key)=>{return [key,{
            config:{
                width: WIDTH,
                height:HEIGHT,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation:true,
                    preload: path.join(__dirname, 'preload.js'),
                }
            },
            filePath:null
        }
        ]}));
        this.defs.get("devShell").filePath=path.join(__dirname, '../renderer/view/index.html');
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
        if(this.isDevMode()){
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
        if(this.isDevMode()) windowKey="devShell";
        const selected=this.windows.get(windowKey);
        if(!selected){return null;}
        if(selected.isDestroyed()){return null;}
        return selected;
    }
    async create(windowKey){
        const newWindow=new BrowserWindow(this.defs.get(windowKey).config);
        this.windows.set(windowKey,newWindow);
        await newWindow.loadFile(this.defs.get(windowKey).filePath);
        newWindow.on('close',()=>{
            this.windows.set(windowKey,null);
        })
        return newWindow;
    }
    async toggle(windowKey){
        if(this.isDevMode()) windowKey="devShell";
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

}
const wm=new WindowManager();
module.exports = {wm};