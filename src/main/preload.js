const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld("api",{
    ping:()=>ipcRenderer.invoke("app:ping"),
    onShowView:(handler)=>{
        ipcRenderer.on("ui:showView", (event, payload) => {
            handler(payload);
        });
    },
    openWindow:(windowKey)=>ipcRenderer.invoke("app:openWindow",windowKey),
    chat:(message)=>ipcRenderer.invoke("app:aiChat",message),
    getAiContextMeta:()=>ipcRenderer.invoke("app:getAiContextMeta"),
    getAiContextData:()=>ipcRenderer.invoke("app:getAiContextData"),
    clearAiContext:()=>ipcRenderer.invoke("app:clearAiContext"),
    getLongTermMemoryData:()=>ipcRenderer.invoke("app:getLongTermMemoryData"),
    touch: (name)=>ipcRenderer.invoke("app:touch",name),
    loadPomodoroJson:()=>ipcRenderer.invoke("app:loadPomodoroJson"),
    savePomodoroJson:(data)=>ipcRenderer.invoke("app:savePomodoroJson",data),
});
