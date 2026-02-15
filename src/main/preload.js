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
    touch: (name)=>ipcRenderer.invoke("app:touch",name)
});