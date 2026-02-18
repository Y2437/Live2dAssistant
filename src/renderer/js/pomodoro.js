const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const dom = {
    root: $('[data-pomo="root"]'),
    // pages
    panelEdit: $('[data-pomo="panel-edit"]'),
    panelList: $('[data-pomo="panel-list"]'),
    panelRun: $('[data-pomo="panel-run"]'),

    // list
    btnAdd: $('[data-pomo-action="add"]'),
    btnEdit: $('[data-pomo-action="edit"]'),
    btnDelete: $('[data-pomo-action="delete"]'),
    taskList: $('[data-pomo="task-list"]'),
    empty: $('[data-pomo="empty"]'),
    btnGo: $('[data-pomo-action="go"]'),

    // edit
    btnCancel: $('[data-pomo-action="cancel"]'),
    btnConfirm: $('[data-pomo-action="confirm"]'),
    inputTitle: $('[data-pomo="task-name"]'),
    inputCycles: $('[data-pomo="cycle-input"]'),
    btnCycleInc: $('[data-pomo-action="cycle-inc"]'),
    btnCycleDec: $('[data-pomo-action="cycle-dec"]'),
    workDigitTen: $('[data-pomo-digit="work"][data-digit-pos="t"]'),
    workDigitOne: $('[data-pomo-digit="work"][data-digit-pos="o"]'),
    restDigitTen: $('[data-pomo-digit="rest"][data-digit-pos="t"]'),
    restDigitOne: $('[data-pomo-digit="rest"][data-digit-pos="o"]'),

    // run
    runCard: $('[data-pomo="run-card"]'),
    phase: $('[data-pomo="phase"]'),
    cycleCur: $('[data-pomo="cycle-cur"]'),
    cycleTotal: $('[data-pomo="cycle-total"]'),
    btnBack: $('[data-pomo-action="back"]'),
    btnStop: $('[data-pomo-action="stop"]'),
    btnPause: $('[data-pomo-action="pause"]'),
    runMmDigitTen: $('[data-pomo-digit="run-mm"][data-digit-pos="t"]'),
    runMmDigitOne: $('[data-pomo-digit="run-mm"][data-digit-pos="o"]'),
    runSsDigitTen: $('[data-pomo-digit="run-ss"][data-digit-pos="t"]'),
    runSsDigitOne: $('[data-pomo-digit="run-ss"][data-digit-pos="o"]'),
    confetti: $('[data-pomo="confetti"]'),
};

const pomodoroState={
    page:null,   //edit ,list ,run
    taskList:null,
    index:1,  //只能从1开始,从0开始会导致第一个任务ID为0,会被edit排除
    selectedTaskId:null,
    runningTaskId:null,
    editingTask:null,
    timer:{
        phase:"idle", //idle,work ,rest
        status:"idle", //running,paused,done,idle,finished
        cycleCur:0,
        cycleTotal:0,
        phaseRemainMs:0,
        phaseTotalMs:0,
        timerHandle:null,
    }
}
function parseTimeStamp(timeStamp){
    return timeStamp.minute*60000+timeStamp.second*1000+timeStamp.microSeconds;
}
function parseMs(ms){
    return{minute:Math.floor(ms/60000),second:Math.floor((ms%60000)/1000),microSeconds:ms%1000};
}
function parseMinutesToMs(minutes){
    return minutes*60000;
}
function parseMsToMinutes(ms){
    return Math.floor(ms/60000);
}
function parseNumToDigits(num){
    return {ten:Math.floor(num/10),one:num%10};
}
function parseDigitsToNum(digits){
    return digits.ten*10+digits.one;
}

function switchPage(page){
    if(page!=="edit"&&page!=="list"&&page!=="run")
        return;
    if(page==="list") renderTaskList();
    const root = dom.root;
    root.dataset.page=page;
    pomodoroState.page=page;
    console.log("switchPage"+pomodoroState.page);
}
function switchStatus(status){
    if(status!=="idle"&&status!=="work"&&status!=="rest")
        return;
    const root = dom.root;
    root.dataset.timer=status;
    pomodoroState.timer.status=status;
    console.log("switchStatus"+pomodoroState.timer.status);
}
function wireListBtn(){
    //`button[data-pomo-action="add"]` `button[data-pomo-action="edit"]`  `button[data-pomo-action="delete"]`
    const addBtn=dom.btnAdd;
    const editBtn=dom.btnEdit;
    const deleteBtn=dom.btnDelete;
    const goBtn=dom.btnGo;
    console.log(addBtn);
    console.log(editBtn);
    console.log(deleteBtn);
    console.log(goBtn);
    goBtn.innerText="GO!"
    addBtn.addEventListener("click",()=>{// 添加新任务,并进入编辑
        console.log("addBtn");
        addTask();
    });
    const task=pomodoroState.taskList.find(t=>t.id===pomodoroState.selectedTaskId);
    if(!task) editBtn.classList.add("disabled");
    editBtn.addEventListener("click",()=>{  //编辑pomodoroState.selectedTaskId对应的Task
        if(editBtn.classList.contains("disabled")) return;
        console.log("editBtn");
        const task=pomodoroState.taskList.find(t=>t.id===pomodoroState.selectedTaskId);
        switchPage("edit");
        showEditingTask(task);
    });
    if(!task) deleteBtn.classList.add("disabled");
    deleteBtn.addEventListener("click",()=>{  //删除pomodoroState.selectedTaskId对应的Task
        if(deleteBtn.classList.contains("disabled")) return;
        console.log("deleteBtn");
        pomodoroState.taskList=pomodoroState.taskList.filter(t=>t.id!==pomodoroState.selectedTaskId);
        renderTaskList();
    });
    if(!task) goBtn.classList.add("disabled");
    goBtn.addEventListener("click",()=>{  //开始pomodoroState.selectedTaskId对应的Task
        if(goBtn.classList.contains("disabled")) return;
        console.log("goBtn");
        switchPage("run");
    });
}
function showEditingTask(task){
    switchPage("edit");
    console.log("showEditingTask",task);
    pomodoroState.editingTask=task;
    dom.inputTitle.value=task.title;
    dom.inputCycles.value=task.repeatTimes;
    const workMinutes=parseMsToMinutes(task.workTime);
    const restMinutes=parseMsToMinutes(task.restTime);
    const workDigits=parseNumToDigits(workMinutes);
    const restDigits=parseNumToDigits(restMinutes);
    //<div class="pomoDigit" data-pomo-digit="work" data-digit-pos="o" style="--pomo-digit:5">
    dom.workDigitTen.style.setProperty("--pomo-digit",workDigits.ten.toString());
    dom.workDigitOne.style.setProperty("--pomo-digit",workDigits.one.toString());
    dom.restDigitTen.style.setProperty("--pomo-digit",restDigits.ten.toString());
    dom.restDigitOne.style.setProperty("--pomo-digit",restDigits.one.toString());
    console.log(workDigits,restDigits);
    console.log(dom.workDigitTen.style.getPropertyValue("--pomo-digit"));
}
function addTask(){
    switchPage("edit");
    console.log("addTask");
    const newTask=new Task(null,"新任务",25,5,3);
    //这里不分配ID,因为不一定会确认添加这个任务
    showEditingTask(newTask);
    pomodoroState.editingTask=newTask;

}
function saveEditingTask(){  //编辑pomodoroState.editingTask对应的Task
    console.log("saveEditingTask");
    const title=dom.inputTitle.value;
    const workTimeDigitTen=parseInt(dom.workDigitTen.style.getPropertyValue("--pomo-digit"));
    const workTimeDigitOne=parseInt(dom.workDigitOne.style.getPropertyValue("--pomo-digit"));
    const workMinutes=parseDigitsToNum({ten:workTimeDigitTen,one:workTimeDigitOne});
    const restTimeDigitTen=parseInt(dom.restDigitTen.style.getPropertyValue("--pomo-digit"));
    const restTimeDigitOne=parseInt(dom.restDigitOne.style.getPropertyValue("--pomo-digit"));
    const restMinutes=parseDigitsToNum({ten:restTimeDigitTen,one:restTimeDigitOne});
    const repeatTimes=parseInt(dom.inputCycles.value);
    pomodoroState.editingTask.title=title;
    pomodoroState.editingTask.workTime=parseMinutesToMs(workMinutes);
    pomodoroState.editingTask.restTime=parseMinutesToMs(restMinutes);
    pomodoroState.editingTask.repeatTimes=repeatTimes;
    console.log(pomodoroState.editingTask);
    if(!pomodoroState.editingTask.id) {
        pomodoroState.editingTask.id=pomodoroState.index++;
        pomodoroState.taskList.push(pomodoroState.editingTask);
    }  //为新创建的任务分配ID
}
function wireEditBtn(){
    const cancelBtn=dom.btnCancel;
    const confirmBtn=dom.btnConfirm;
    cancelBtn.addEventListener("click",()=>{
        console.log("cancelBtn");
        pomodoroState.editingTask=null;
        switchPage("list");
    });
    confirmBtn.addEventListener("click",()=>{
        if(confirmBtn.classList.contains("disabled")) return;
        console.log("confirmBtn");
        saveEditingTask();
        showEditingTask(pomodoroState.editingTask);

        switchPage("list");
    });


    const cycleIncBtn=dom.btnCycleInc;
    const cycleDecBtn=dom.btnCycleDec;
    cycleIncBtn.addEventListener("click",()=>{
        dom.inputCycles.value=parseInt(dom.inputCycles.value)+1;
    });
    cycleDecBtn.addEventListener("click",()=>{
        dom.inputCycles.value=Math.max(parseInt(dom.inputCycles.value)-1,1);
    });

    const digits = [
        dom.workDigitTen,
        dom.workDigitOne,
        dom.restDigitTen,
        dom.restDigitOne
    ];
    digits.forEach(el => {
        el.addEventListener("contextmenu", (e) => {
            e.preventDefault();
        });
        el.addEventListener("mousedown", (e) => {
            const container = e.currentTarget;
            let currentVal = parseInt(container.style.getPropertyValue("--pomo-digit"));
            if (isNaN(currentVal)) currentVal = 0;
            if(e.button === 0){
                currentVal = (currentVal + 1) % 10;
            } else if (e.button === 2){
                currentVal = (currentVal - 1 + 10) % 10;
            } else {
                return;
            }
            container.style.setProperty("--pomo-digit", currentVal.toString());
            console.log("Digit changed to:", currentVal);
            const workTimeDigitTen=parseInt(dom.workDigitTen.style.getPropertyValue("--pomo-digit"));
            const workTimeDigitOne=parseInt(dom.workDigitOne.style.getPropertyValue("--pomo-digit"));
            const workMinutes=parseDigitsToNum({ten:workTimeDigitTen,one:workTimeDigitOne});
            const restTimeDigitTen=parseInt(dom.restDigitTen.style.getPropertyValue("--pomo-digit"));
            const restTimeDigitOne=parseInt(dom.restDigitOne.style.getPropertyValue("--pomo-digit"));
            const restMinutes=parseDigitsToNum({ten:restTimeDigitTen,one:restTimeDigitOne});
            if(workMinutes===0||restMinutes===0||isNaN(workMinutes)||isNaN(restMinutes)){
                console.log("Invalid time settings");
                dom.btnConfirm.classList.add("disabled");
            }else dom.btnConfirm.classList.remove("disabled");
        });
    });
}
function wireRunBtn(){
    const backBtn=dom.btnBack;
    const stopBtn=dom.btnStop;
    const pauseBtn=dom.btnPause;
    pauseBtn.innerText="暂停";
    backBtn.addEventListener("click",()=>{
        console.log("backBtn");
        switchPage("list");
    });
    stopBtn.addEventListener("click",()=>{
        console.log("stopBtn");
    });
    pauseBtn.addEventListener("click",()=>{
        console.log("pauseBtn");
        pauseBtn.innerText=pauseBtn.innerText==="暂停"?"继续":"暂停";
    });
}
class Task{
    constructor(id,title,workTime,restTime,repeat){
        this.id = id;
        this.title = title;
        this.workTime = parseMinutesToMs(workTime);
        this.restTime = parseMinutesToMs(restTime);
        this.repeatTimes = repeat;
    }
}
async function initTaskList(){
    console.log("initTaskList");
    pomodoroState.taskList=[];
    await window.api.loadPomodoroJson().then(data=>{
        if(data.length===0) return;
        pomodoroState.taskList=data;
        pomodoroState.index=Math.max(pomodoroState.taskList.map(t=>t.id))+1;
    });
}
function renderTaskList(){
    const taskListDom=dom.taskList;
    taskListDom.innerHTML="";
    if(pomodoroState.taskList.length===0){
        dom.empty.style.display="grid";
        return;
    }
    const selectedTask=pomodoroState.taskList.find(t=>t.id===pomodoroState.selectedTaskId);
    if(!selectedTask) {
        dom.btnEdit.classList.add("disabled");
        dom.btnDelete.classList.add("disabled");
        dom.btnGo.classList.add("disabled");
    }
    else {
        dom.btnEdit.classList.remove("disabled");
        dom.btnDelete.classList.remove("disabled");
        dom.btnGo.classList.remove("disabled");
    }
    pomodoroState.taskList.forEach(task=>{
        const li=makePomoItem(task);
        if(pomodoroState.selectedTaskId===task.id) li.classList.add("selected");
        taskListDom.appendChild(li);
    });
}
function wireDragList(){
    dom.taskList.addEventListener("dragover",e=>{
        e.preventDefault();
        const afterElement=getDragAfterElement(dom.taskList,e.clientY);
        const dragging=$(".dragging");
        if(afterElement==null) dom.taskList.appendChild(dragging);
        else dom.taskList.insertBefore(dragging,afterElement);
    });
}
function getDragAfterElement(container,y){
    const elements=[...container.querySelectorAll(".pomoItem:not(.dragging)")];
    return elements.reduce((closest,child)=>{
        const box=child.getBoundingClientRect();
        const offset=y-box.top-box.height/2;
        if(offset<0&&offset>closest.offset) return {offset:offset,element:child};
        else return closest;
    },{offset:Number.NEGATIVE_INFINITY}).element;
}
function updateTaskOrder(){
    const newIds=[...dom.taskList.querySelectorAll(".pomoItem")].map(li=>parseInt(li.getAttribute("data-task-id")));
    const taskMap=new Map(pomodoroState.taskList.map(t=>[t.id,t]));
    pomodoroState.taskList=newIds.map(id=>taskMap.get(id));
}
function makePomoItem(task) {
    const li = document.createElement("li");
    const title = document.createElement("span");
    const editBtn = document.createElement("button");
    const deleteBtn = document.createElement("button");
    const handle = document.createElement("button");
    handle.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16">
        <path fill="currentColor" d="M20 9H4v2h16V9zM4 15h16v-2H4v2z"/></svg>`;
    editBtn.innerHTML=`<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M14 6l4 4" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`;
    deleteBtn.innerHTML=`<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M4 7h16" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M6 7l1-3h10l1 3" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M7 7l1 14h8l1-14" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`;
    title.innerText=task.title;
    li.setAttribute("data-task-id",task.id);
    title.classList.add("pomoItem__title");
    editBtn.classList.add("pomoIconBtn");
    deleteBtn.classList.add("pomoIconBtn");
    handle.classList.add("pomoItem__handle");
    handle.addEventListener("mouseenter",()=>li.setAttribute("draggable","true"));
    handle.addEventListener("mouseleave",()=>li.setAttribute("draggable","false"));
    li.addEventListener("dragstart",()=>{
        li.classList.add("dragging");
    });
    li.addEventListener("dragend",()=>{
        li.classList.remove("dragging");
        updateTaskOrder();
    });
    dom.taskList.addEventListener("click",(event)=>{
        if(event.target.classList.contains("pomoItem")||event.target.classList.contains("pomoItem__title")) return;
        dom.taskList.querySelectorAll(".pomoItem.selected").forEach(item=>item.classList.remove("selected"));
        renderTaskList();
    })
    li.addEventListener("click",(event)=>{
        if(!event.target.classList.contains("pomoItem")&&!event.target.classList.contains("pomoItem__title")) return;
        const li=event.target.closest(".pomoItem");
        console.log("itemClick",li.getAttribute("data-task-id"));
        pomodoroState.selectedTaskId=parseInt (li.getAttribute("data-task-id"));
        renderTaskList();
    });
    editBtn.addEventListener("click",(event)=>{
        const li=event.target.closest(".pomoItem");
        console.log("editBtn",li.getAttribute("data-task-id"));
        pomodoroState.editingTask=pomodoroState.taskList.find(t=>t.id===parseInt(li.getAttribute("data-task-id")));
        console.log("editingTask",pomodoroState.editingTask);
        showEditingTask(pomodoroState.editingTask);
        switchPage("edit");
    });
    deleteBtn.addEventListener("click",(event)=>{
        const li=event.target.closest(".pomoItem");
        console.log("deleteBtn",li.getAttribute("data-task-id"));
        pomodoroState.selectedTaskId=parseInt(li.getAttribute("data-task-id"));
        pomodoroState.taskList=pomodoroState.taskList.filter(t=>t.id!==parseInt(li.getAttribute("data-task-id")));
        renderTaskList();
    });
    li.classList.add("pomoItem");
    li.appendChild(handle);
    li.appendChild(title);
    li.appendChild(editBtn);
    li.appendChild(deleteBtn);

    return li;
}

document.addEventListener("DOMContentLoaded", async () => {
    await initTaskList();
    switchPage("list");
    wireListBtn();
    wireRunBtn();
    wireEditBtn();
    wireDragList();
})