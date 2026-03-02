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
        status:"idle", //running,paused,done,idle
        cycleCur:0,
        cycleTotal:0,
        phaseRemainMs:0,
        phaseTotalMs:0,
        handle:null,
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
//     phase:"idle", //idle,work ,rest
//     status:"idle", //running,paused,done,idle
function switchStatus(status){
    if(status!=="idle"&&status!=="running"&&status!=="paused"&&status!=="done")
        return;
    const root = dom.root;
    root.dataset.status=status;
    pomodoroState.timer.status=status;
    console.log("switchStatus"+pomodoroState.timer.status);
}
function switchPhase(phase){
    if(phase!=="idle"&&phase!=="work"&&phase!=="rest")
        return;
    const root = dom.root;
    root.dataset.phase=phase;
    pomodoroState.timer.phase=phase;
    console.log("switchPhase"+pomodoroState.timer.phase);
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
        loadTask(pomodoroState.taskList.find(t=>t.id===pomodoroState.selectedTaskId));
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
function lockEditingTask(){
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
}
function wireEditBtn(){
    const cancelBtn=dom.btnCancel;
    const confirmBtn=dom.btnConfirm;
    cancelBtn.addEventListener("click",()=>{
        console.log("cancelBtn");
        pomodoroState.editingTask=null;
        pomodoroState.timer.handle
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
            lockEditingTask();
        });
        el.addEventListener("wheel",e=>{
            e.preventDefault();
            const container=e.currentTarget;
            let val=parseInt(container.style.getPropertyValue("--pomo-digit"))||0;
            if(e.deltaY<0) val=(val+1)%10;
            else val=(val-1+10)%10;
            container.style.setProperty("--pomo-digit",val.toString());
            lockEditingTask();

        },{passive:false});
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
        clearRunningTask();
    });
    pauseBtn.addEventListener("click",()=>{
        console.log("pauseBtn");

        switchStatus(pomodoroState.timer.status==="running"?"paused":"running");
        pauseBtn.innerText=pauseBtn.innerText==="暂停"?"继续":"暂停";
        if(pomodoroState.timer.status==="paused") pauseRunningTask();
        else resumeRunningTask();
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
function onTimerTick(remainMs,totalMs){
    const progress=remainMs/totalMs;
    dom.runCard.__pomoWave.setProgress(progress);
    const timeStamp=parseMs(remainMs);
    const minutes=timeStamp.minute;
    const seconds=timeStamp.second;
    setTimeDigits(minutes,seconds);
    console.log("onTimerTick",progress);
    console.log("remainMs",remainMs,"totalMs",totalMs);
}
const timeInterVal=()=>{
    onTimerTick(pomodoroState.timer.phaseRemainMs,pomodoroState.timer.phaseTotalMs);
    pomodoroState.timer.phaseRemainMs-=100;
    if(pomodoroState.timer.phaseRemainMs<=0){
        pomodoroState.timer.phaseRemainMs=0;
    }
}
function loadTask(task){
    pomodoroState.runningTaskId=task.id;
    switchStatus("running");
    pomodoroState.timer.cycleCur=1;
    pomodoroState.timer.cycleTotal=task.repeatTimes;
    pomodoroState.timer.phaseRemainMs=task.workTime;
    pomodoroState.timer.phaseTotalMs=task.workTime;
    dom.runCard.__pomoWave.setProgress(1.0);
    pomodoroState.timer.handle=setInterval(timeInterVal,100);
}
function pauseRunningTask(){
    clearInterval(pomodoroState.timer.handle);
    pomodoroState.timer.handle=null;
    pomodoroState.timer.status="paused";
}
function resumeRunningTask(){
    pomodoroState.timer.handle=setInterval(timeInterVal,100);
    pomodoroState.timer.status="running";
}
function setTimeDigits(minutes,seconds){
    // runMmDigitTen: $('[data-pomo-digit="run-mm"][data-digit-pos="t"]'),
    //     runMmDigitOne: $('[data-pomo-digit="run-mm"][data-digit-pos="o"]'),
    //     runSsDigitTen: $('[data-pomo-digit="run-ss"][data-digit-pos="t"]'),
    //     runSsDigitOne: $('[data-pomo-digit="run-ss"][data-digit-pos="o"]'),
    let minuteDigitTen=dom.runMmDigitTen;
    let minuteDigitOne=dom.runMmDigitOne;
    let secondDigitTen=dom.runSsDigitTen;
    let secondDigitOne=dom.runSsDigitOne;
    minuteDigitTen.style.setProperty("--pomo-digit",(Math.floor(minutes/10)).toString());
    minuteDigitOne.style.setProperty("--pomo-digit",(minutes%10).toString());
    secondDigitTen.style.setProperty("--pomo-digit",(Math.floor(seconds/10)).toString());
    secondDigitOne.style.setProperty("--pomo-digit",(seconds%10).toString());
    console.log(minutes,seconds);
}
function switchToNextPhase(){
    const task=pomodoroState.taskList.find(t=>t.id===pomodoroState.runningTaskId);
    if(!task) return;
    if(pomodoroState.timer.cycleCur<pomodoroState.timer.cycleTotal){
        pomodoroState.timer.cycleCur++;
        pomodoroState.timer.phaseRemainMs=task.workTime;
        pomodoroState.timer.phaseTotalMs=task.workTime;
        pomodoroState.timer.phase="work";
    }else{
    }
}
function finishRunningTask(){
    const task=pomodoroState.taskList.find(t=>t.id===pomodoroState.runningTaskId);
    if(!task) return;
    clearRunningTask();
    pomodoroState.timer.status="finished";
}
function clearRunningTask(){
    clearInterval(pomodoroState.timer.handle);
    dom.runCard.__pomoWave.setProgress(1.0);
    pomodoroState.timer.phaseRemainMs=0;
    pomodoroState.timer.phaseTotalMs=0;
    pomodoroState.timer.cycleCur=0;
    pomodoroState.timer.cycleTotal=0;
    pomodoroState.timer.phase="idle";
    pomodoroState.timer.status="idle";
    pomodoroState.timer.handle=null;
    pomodoroState.runningTaskId=null;
    switchPage("list");
}

document.addEventListener("DOMContentLoaded", async () => {
    await initTaskList();
    document.querySelector('[data-pomo="run-card"]').__pomoWave = new PomoWaveEngine(document.querySelector('[data-pomo="run-card"]'));
    document.querySelector('[data-pomo="run-card"]').__pomoWave.setProgress(1);
    switchPage("list");
    wireListBtn();
    wireRunBtn();
    wireEditBtn();
    wireDragList();

})

class PomoWaveEngine {
    constructor(cardEl) {
        this.card    = cardEl;
        this.canvas  = cardEl.querySelector('[data-pomo="wave-canvas"]');
        this.rainbow = cardEl.querySelector('[data-pomo="rainbow-border"]');
        this.ctx     = this.canvas.getContext('2d');

        this.progress = 1.0;  // 当前显示值（平滑插值）
        this.target   = 1.0;  // 目标值
        this.T        = 0;
        this.lastNow  = null;
        this.W = 0; this.H = 0;

        // 彩虹色带
        this.COLORS = ['#ff0055','#ff6600','#ffcc00','#00ff99','#0099ff','#cc33ff','#ff0055'];

        // 波浪层定义（纯正弦叠加，天然无缝循环）
        this.LAYERS = [
            {   // 主波浪：与彩虹边框对齐
                comps: [
                    { amp: 14, freq: 0.018, speed: 0.55 },
                    { amp:  5, freq: 0.042, speed: 0.80 },
                ],
                lineWidth: 3.5, alpha: 1.0, blur: 0, isMaster: true,
            },
            {   // 次波浪：反相，中振幅
                comps: [
                    { amp: 10, freq: 0.022, speed: -0.45 },
                    { amp:  4, freq: 0.055, speed: -0.70 },
                ],
                lineWidth: 2.5, alpha: 0.55, blur: 1.0, isMaster: false,
            },
            {   // 细波浪：高频，小振幅
                comps: [
                    { amp:  5, freq: 0.060, speed: 1.10 },
                    { amp:  2, freq: 0.090, speed: 1.40 },
                ],
                lineWidth: 1.5, alpha: 0.30, blur: 0.5, isMaster: false,
            },
        ];

        this._resize();
        new ResizeObserver(() => this._resize()).observe(cardEl);
        requestAnimationFrame(t => this._tick(t));
    }

    setProgress(p) {
        this.target = Math.max(0, Math.min(1, p));
    }

    _resize() {
        const r = this.card.getBoundingClientRect();
        this.W = r.width; this.H = r.height;
        const dpr = devicePixelRatio || 1;
        this.canvas.width  = Math.round(this.W * dpr);
        this.canvas.height = Math.round(this.H * dpr);
        this.canvas.style.width  = this.W + 'px';
        this.canvas.style.height = this.H + 'px';
        this.ctx.setTransform(1,0,0,1,0,0);
        this.ctx.scale(dpr, dpr);
    }

    _layerY(layer, x, baseY) {
        let dy = 0;
        for (const c of layer.comps) {
            dy += c.amp * Math.sin(c.freq * x + c.speed * this.T * Math.PI * 2);
        }
        return baseY + dy;
    }

    /* 构建平滑路径（不含 stroke/fill，供多处复用） */
    _buildPath(pts) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i].x + pts[i+1].x) / 2;
            const my = (pts[i].y + pts[i+1].y) / 2;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
    }

    /* ① 液面填充：波浪线以下区域的渐变填充 */
    _drawFluidFill(masterPts) {
        const { ctx, W, H } = this;
        ctx.save();
        const avgY = masterPts.reduce((s, p) => s + p.y, 0) / masterPts.length;
        const grad = ctx.createLinearGradient(0, avgY - 20, 0, H);
        grad.addColorStop(0.00, 'rgba(120, 80, 255, 0.18)');
        grad.addColorStop(0.25, 'rgba( 60, 80, 200, 0.12)');
        grad.addColorStop(0.60, 'rgba( 20, 20,  80, 0.07)');
        grad.addColorStop(1.00, 'rgba(  0,  0,   0, 0.00)');
        this._buildPath(masterPts);
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
    }

    /* ② 液面折射辉光：主波浪线正下方的宽光带 */
    _drawFluidGlow(masterPts) {
        const { ctx, W } = this;
        ctx.save();
        ctx.filter = 'blur(8px)';
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 18;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        this.COLORS.forEach((c, i) => grad.addColorStop(i / (this.COLORS.length - 1), c));
        ctx.strokeStyle = grad;
        const shifted = masterPts.map(p => ({ x: p.x, y: p.y + 6 }));
        this._buildPath(shifted);
        ctx.stroke();
        ctx.restore();
    }

    /* ③ 波浪线本体 */
    _drawLayer(layer, pts) {
        const { ctx, W } = this;
        ctx.save();
        if (layer.blur > 0) ctx.filter = `blur(${layer.blur}px)`;
        ctx.globalAlpha = layer.alpha;
        ctx.lineWidth   = layer.lineWidth;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        this.COLORS.forEach((c, i) => grad.addColorStop(i / (this.COLORS.length - 1), c));
        ctx.strokeStyle = grad;
        this._buildPath(pts);
        ctx.stroke();
        ctx.restore();
    }

    _syncClip(masterPts) {
        const { W, H } = this;
        const stride = Math.max(1, Math.floor(masterPts.length / 80));
        const poly = [];
        for (let i = 0; i < masterPts.length; i += stride) {
            poly.push(`${(masterPts[i].x/W*100).toFixed(2)}% ${(masterPts[i].y/H*100).toFixed(2)}%`);
        }
        const last = masterPts[masterPts.length-1];
        poly.push(`${(last.x/W*100).toFixed(2)}% ${(last.y/H*100).toFixed(2)}%`);
        poly.push('100% 100%', '0% 100%');
        this.rainbow.style.clipPath = `polygon(${poly.join(',')})`;
    }

    _tick(now) {
        if (!this.lastNow) this.lastNow = now;
        const dt = Math.min((now - this.lastNow) / 1000, 0.05);
        this.lastNow = now;
        this.T += dt;
        this.progress += (this.target - this.progress) * Math.min(dt * 6, 1);

        const { ctx, W, H, LAYERS } = this;
        ctx.clearRect(0, 0, W, H);

        const baseY = (1 - this.progress) * H;

        // 第一遍：采样所有层的点
        const layerPts = LAYERS.map(layer => {
            const pts = [];
            for (let x = 0; x <= W; x += 3) {
                pts.push({ x, y: this._layerY(layer, x, baseY) });
            }
            if (pts[pts.length-1].x < W) {
                pts.push({ x: W, y: this._layerY(layer, W, baseY) });
            }
            return pts;
        });

        const masterPts = layerPts[LAYERS.findIndex(l => l.isMaster)];

        // 绘制顺序（从下到上）：填充 → 辉光 → 波浪线
        this._drawFluidFill(masterPts);
        this._drawFluidGlow(masterPts);
        LAYERS.forEach((layer, i) => this._drawLayer(layer, layerPts[i]));

        this._syncClip(masterPts);

        requestAnimationFrame(t => this._tick(t));
    }
}