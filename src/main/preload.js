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
    agentChat:(message)=>ipcRenderer.invoke("app:agentChat",message),
    getAiContextMeta:()=>ipcRenderer.invoke("app:getAiContextMeta"),
    getAiContextData:()=>ipcRenderer.invoke("app:getAiContextData"),
    clearAiContext:()=>ipcRenderer.invoke("app:clearAiContext"),
    getLongTermMemoryData:()=>ipcRenderer.invoke("app:getLongTermMemoryData"),
    extractLongTermMemories:()=>ipcRenderer.invoke("app:extractLongTermMemories"),
    deleteLongTermMemory:(memoryId)=>ipcRenderer.invoke("app:deleteLongTermMemory",memoryId),
    getAgentCapabilities:()=>ipcRenderer.invoke("app:getAgentCapabilities"),
    getAgentLibraryIndex:()=>ipcRenderer.invoke("app:getAgentLibraryIndex"),
    readAgentLibraryFile:(filePath)=>ipcRenderer.invoke("app:readAgentLibraryFile",filePath),
    rebuildAgentLibraryIndex:()=>ipcRenderer.invoke("app:rebuildAgentLibraryIndex"),
    touch: (name)=>ipcRenderer.invoke("app:touch",name),
    loadPomodoroJson:()=>ipcRenderer.invoke("app:loadPomodoroJson"),
    savePomodoroJson:(data)=>ipcRenderer.invoke("app:savePomodoroJson",data),
    loadKnowledgeCards:()=>ipcRenderer.invoke("app:loadKnowledgeCards"),
    createKnowledgeCard:(data)=>ipcRenderer.invoke("app:createKnowledgeCard",data),
    updateKnowledgeCard:(data)=>ipcRenderer.invoke("app:updateKnowledgeCard",data),
    generateKnowledgeCardSummary:(data)=>ipcRenderer.invoke("app:generateKnowledgeCardSummary",data),
    deleteKnowledgeCard:(cardId)=>ipcRenderer.invoke("app:deleteKnowledgeCard",cardId),
});
