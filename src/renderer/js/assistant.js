import {CONFIG} from "./config.js";
import {marked} from "../vendor/marked/lib/marked.esm.js";

const getElementById = (el,root=document) => root.querySelector(el);
const getAllElementsById = (el,root=document) => Array.from(root.querySelectorAll(el));

const assistantState = {
    pixiApp: null,
    stage: null,
    live2d: null,
    bubble: null,
    bubbleQueue:null,
    bubbleState:"free",   // free | thinking | showing | touching


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





const BUBBLE_START=["free","thinking","showing","touching"]
class bubbleEvent{
    constructor(type,content){
        if(type!=="touch"&&type!=="chat"){ throw new Error("不支持的气泡类型"); }
        this.type =type;  //touch,chat
        this.content=content;  // String
    }
}
function toggleBubbleVisibility(setVisibility){
    const bubble = assistantState.bubble;
    if(setVisibility){
        bubble.classList.remove("is-hiding");
        bubble.classList.add("is-visible");
        return;
    }
    if(!bubble.classList.contains("is-visible")) {
        return;
    }
    bubble.classList.add("is-hiding");
    const onEnd = (e) => {
        if(e.target !== bubble){
            return;
        }
        if(e.propertyName !== "opacity"){
            return;
        }
        bubble.classList.remove("is-visible");
        bubble.classList.remove("is-hiding");
        bubble.removeEventListener("transitionend", onEnd);
    };
    bubble.addEventListener("transitionend", onEnd);
}

async function solveBubbleEvent(event){
    if(event.type==="touch"){
        if(assistantState.bubbleState==="free"||assistantState.bubbleState==="touching"){
            if(assistantState.bubbleTimer){
                clearTimeout(assistantState.bubbleTimer);
                assistantState.bubbleTimer = null;
            }
            assistantState.bubbleState="touching";
            let  response= await solveTouchEvent(event.content);
            showing(response);
            assistantState.bubbleTimer=setTimeout(async ()=>{

                assistantState.bubbleTimer = null;
                assistantState.bubbleState="free";
                toggleBubbleVisibility(false);

                if(assistantState.bubbleQueue.length > 0){
                    await solveFrontEvent();
                }
            },TIMEOUT_MS);

        }else {
            console.log("气泡窗口正忙")
        }
    }else if(event.type==="chat"){
        assistantState.bubbleQueue.push(solveChatEvent(event.content));
        if(assistantState.bubbleState==="free"||assistantState.bubbleState==="touching"){
            if(assistantState.bubbleTimer){
                clearTimeout(assistantState.bubbleTimer);
                assistantState.bubbleTimer = null;
            }
            await solveFrontEvent();
        }
    }else{
        console.log("不支持的气泡类型");
    }
}
async function solveFrontEvent(){
    if(assistantState.bubbleQueue.length>0){
        toggleBubbleVisibility(true);
        assistantState.bubbleState="thinking";
        thinking();
        let  response=await assistantState.bubbleQueue.shift();
        assistantState.bubbleState="showing";
        showing(response);
        assistantState.bubbleTimer = setTimeout(async () => {
            assistantState.bubbleTimer = null;
            toggleBubbleVisibility(false);
            const hasNext = await solveFrontEvent();
            if(!hasNext){
                assistantState.bubbleState = "free";
            }
        }, TIMEOUT_MS);

        return true;
    }else return false;
}





async function getResponse(text){
    return (await window.api.chat(text)).choices[0].message.content;
}

async function solveTouchEvent(name){
    console.log(name);
    return await window.api.touch(name);
}
async function solveChatEvent(text){
    console.log(text);
    return await getResponse(text);
}
function thinking(){
    showing("思考中...");
}
function showing(text){
    console.log(text);
    toggleBubbleVisibility(true);
    const bubble = assistantState.bubble;
    bubble.classList.remove("is-updating");
    void bubble.offsetWidth;
    bubble.classList.add("is-updating");
    bubble.innerHTML = marked.parse(text);
}





function wireHit(){
    assistantState.live2d.on("hit",async (hitArea)=>{
       await solveBubbleEvent(new bubbleEvent("touch",hitArea[0]));
    })
}
function wireInput(){
    const inputForm=getElementById("form.assistant-form");
    const input=getElementById("input.assistant-input[data-role=assistant-input]");
    inputForm.addEventListener("submit", async (event)=>{
        event.preventDefault();
        let context=input.value.trim();
        if(context===''){
            console.log("submitted nothing");
            return;
        }
        input.value="";
        await solveBubbleEvent(new bubbleEvent("chat",context));

    })
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

document.addEventListener('DOMContentLoaded',async ()=>{
    await initAssistant();
    wireInput();
    wireNavBtn();
})
