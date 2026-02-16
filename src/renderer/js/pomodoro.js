import {CONFIG} from "./config.js";
const getElementById = (el,root=document) => root.querySelector(el);
const getAllElementsById = (el,root=document) => Array.from(root.querySelectorAll(el));
const pomodoroState={
    page:null,   //edit ,list ,run
    taskList:null,
    runningTaskId:null,
    editingTaskId:null,
    timer:{
        phase:"idle", //idle,work ,rest
        status:"idle", //running,paused,done,idle
        cycleCur:0,
        cycleTotal:0,
        phaseRemainMs:0,
        phaseTotalMs:0,
        timerHandle:null,
    }


}
class Task{
    constructor(id,workTime,restTime,repeat){
        this.id = id;
        this.workTime = workTime;
        this.restTime = restTime;
        this.repeat = repeat;
    }
}
function parseTimeStamp(timeStamp){
    return timeStamp.minute*60000+timeStamp.second*1000+timeStamp.microSeconds;
}
function parseMs(ms){
    return{minute:Math.floor(ms/60000),second:Math.floor((ms%60000)/1000),microSeconds:ms%1000};
}
function switchPage(page){
    if(page!=="edit"&&page!=="list"&&page!=="run")
        return;
    const root = getElementById("div[data-pomo='root']");
    root.dataset.page=page;
    pomodoroState.page=page;
    console.log("switchPage"+pomodoroState.page);
}
function switchStatus(status){
    if(status!=="idle"&&status!=="work"&&status!=="rest")
        return;
    const root = getElementById("div[data-pomo='root']");
    root.dataset.timer=status;
    pomodoroState.timer.status=status;
    console.log("switchStatus"+pomodoroState.timer.status);
}
function wireListBtn(){
    //`button[data-pomo-action="add"]` `button[data-pomo-action="edit"]`  `button[data-pomo-action="delete"]`
    const addBtn=getElementById("button[data-pomo-action='add']");
    const editBtn=getElementById("button[data-pomo-action='edit']");
    const deleteBtn=getElementById("button[data-pomo-action='delete']");
    console.log(addBtn);
    console.log(editBtn);
    console.log(deleteBtn);
    addBtn.addEventListener("click",()=>{
        console.log("addBtn");
    });
    editBtn.addEventListener("click",()=>{
        console.log("editBtn");
    });
    deleteBtn.addEventListener("click",()=>{
        console.log("deleteBtn");
    });
    //`button[data-pomo-action="go"]`
    const goBtn=getElementById("button[data-pomo-action='go']");
    goBtn.addEventListener("click",()=>{
        console.log("goBtn");
    });
}
function initTaskList(){

}
document.addEventListener("DOMContentLoaded",async ()=>{
    switchPage("run");
    wireListBtn();
})