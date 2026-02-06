
import {CONFIG} from "./config.js";
const getElementById = (el,root=document) => root.querySelector(el);
const getAllElementsById = (el,root=document) => Array.from(root.querySelectorAll(el));
const assistantState = {
    pixiApp: null,
    stage: null,
    live2d: null,
    bubble: null,
    resizeObserver: null,

    baseHeight: null,
    baseWidth: null,

    mounted: false,
};
const WEIGHT_FALLBACK=CONFIG.LIVE2D_CONFIG.WIDTH;
const HEIGHT_FALLBACK=CONFIG.LIVE2D_CONFIG.HEIGHT;
function mountAssistant() {
    if (assistantState.mounted) {
        return;
    }
    assistantState.mounted = true;
    // <div className="assistant-live2d__stage" data-role="assistant-live2d-stage"></div>
    // <div className="assistant-bubble" data-role="assistant-bubble" hidden></div>
    assistantState.stage = getElementById('.assistant-live2d__stage');
    assistantState.bubble = getElementById('.assistant-bubble');
}

function initPixiApp() {
    const width = assistantState.stage.clientWidth || WEIGHT_FALLBACK;
    const height = assistantState.stage.clientHeight || HEIGHT_FALLBACK;
    const app = new window.PIXI.Application({
        width: width,
        height: height,
        antialias: true,
        backgroundAlpha: 0,
    })
    assistantState.pixiApp = app;
    assistantState.stage.appendChild(app.view);
}
async function initLive2d() {
    const live2dUrl=new URL(CONFIG.LIVE2D_CONFIG.model.jsonFile,window.location.href).href;
    const live2d=await window.PIXI.live2d.Live2DModel.from(live2dUrl);
    live2d.scale.set(1);
    assistantState.baseHeight=live2d.height;
    assistantState.baseWidth=live2d.width;
    assistantState.live2d=live2d;
    assistantState.pixiApp.stage.addChild(live2d);
}
function initResizeObserver() {
    assistantState.resizeObserver = new ResizeObserver(()=>{
        const stage=assistantState.stage;
        const app=assistantState.pixiApp;
        const live2d=assistantState.live2d;

        const width=stage.clientWidth;
        const height=stage.clientHeight;

        if(width===0||height===0){
            return;
        }
        app.renderer.resize(width,height);
        live2d.pivot.set(assistantState.baseWidth / 2, assistantState.baseHeight);
        const s = Math.min(width / assistantState.baseWidth, height / assistantState.baseHeight) * 0.9;
        live2d.scale.set(s);
        live2d.position.set(width / 2, height);
    })
    assistantState.resizeObserver.observe(assistantState.stage);
}

async function initAssistant() {
    mountAssistant();
    initPixiApp();
    await initLive2d();
    initResizeObserver();

}
document.addEventListener('DOMContentLoaded',async ()=>{
    await initAssistant();
})
document.addEventListener("",async ()=>{})