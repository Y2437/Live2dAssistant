
import {CONFIG} from "./config.js";
import {marked} from "../vendor/marked/lib/marked.esm.js";
const getElementById = (el,root=document) => root.querySelector(el);
const getAllElementsById = (el,root=document) => Array.from(root.querySelectorAll(el));
const inputForm=getElementById("form.assistant-form");
const input=getElementById("input.assistant-input[data-role=assistant-input]");
let inputText=null;

const assistantState = {
    pixiApp: null,
    stage: null,
    live2d: null,
    bubble: null,
    bubbleQueue:null,
    isBubbleCooling:false,

    resizeObserver: null,
    bubbleTimer:null,

    baseHeight: null,
    baseWidth: null,

    mounted: false,
};
const TIMEOUT_MS = CONFIG.LIVE2D_CONFIG.TIMEOUT_MS;
const SHORTEST_TIME_GAP=CONFIG.LIVE2D_CONFIG.SHORTEST_TIME_GAP
const WEIGHT_FALLBACK=CONFIG.LIVE2D_CONFIG.WIDTH;
const HEIGHT_FALLBACK=CONFIG.LIVE2D_CONFIG.HEIGHT;
function mountAssistant() {
    if (assistantState.mounted) {
        return;
    }
    assistantState.mounted = true;
    assistantState.stage = getElementById('.assistant-live2d__stage[data-role="assistant-live2d-stage"]');
    assistantState.bubble = getElementById('.assistant-bubble[data-role="assistant-bubble"]');
    assistantState.bubbleQueue=[];
    console.log(assistantState.bubble);
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
        live2d.pivot.set(assistantState.baseWidth / 2, assistantState.baseHeight/2);
        const s = Math.min(width / assistantState.baseWidth, height / assistantState.baseHeight) * 1.5;
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
    wireHit()
}
function wireHit(){
    assistantState.live2d.on("hit",async (hitArea)=>{
        console.log(hitArea);
        const response=await window.api.touch(hitArea[0]);
        console.log(response);
        renderBubble(response);
    })
}
const chatWithAi=async (event)=>{
    event.preventDefault();
    let context=input.value.trim();
    if(context===''){
        console.log("submitted nothing");
        return;
    }
    inputText=context;
    console.log(context);
    input.value="";
    let response=await thinkAndGetResponse(context);
    console.log(response);
    renderBubble(response);

}
function wireInput(){
    inputForm.addEventListener("submit", chatWithAi)
}
function wireNavBtn(){
    const navPanel=getElementById("div.assistant-actions[data-role=assistant-actions]");
    navPanel.addEventListener("click", (event)=>{
        const selected=event.target;
        console.log(selected);
        if(!selected.classList.contains("assistant-actionBtn")){
            return;
        }
        window.api.openWindow(selected.dataset.action);
    })
}
async function thinkAndGetResponse(text){
    if(assistantState.isBubbleCooling){
        return "AI接口正在冷却中,请慢点互动哦";
    }
    assistantState.isBubbleCooling=true;
    toggleBubbleVisibility(true);
    assistantState.bubble.innerHTML=marked.parse("思考中...");
    let response= await getResponse(text);
    toggleBubbleVisibility(false);
    setTimeout(()=>{
        assistantState.isBubbleCooling=false;
    },SHORTEST_TIME_GAP)
    return response
}
async function getResponse(text){
    return (await window.api.chat(text)).choices[0].message.content;
}
function toggleBubbleVisibility(setVisibility){
    const bubble=assistantState.bubble;
    if(!bubble){ return}
    if(setVisibility){
        if(!bubble.classList.contains("is-visible")) bubble.classList.add("is-visible");
    }else bubble.classList.remove("is-visible");
}
function renderBubble(text){
    if(assistantState.bubbleTimer){
        clearTimeout(assistantState.bubbleTimer);
    }
    if(!assistantState.bubble){ return}
    assistantState.bubble.innerHTML=marked.parse(text);
    toggleBubbleVisibility(true);
    assistantState.bubbleTimer=setTimeout(()=>{
        toggleBubbleVisibility(false);
    },TIMEOUT_MS)
}
document.addEventListener('DOMContentLoaded',async ()=>{
    await initAssistant();
    wireInput();
    wireNavBtn();
})
