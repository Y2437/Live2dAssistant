import { $, $$ } from "../shared/dom.js";
import { measureAsync, measureSync } from "../shared/perf.js";

const dom = {
    root: $('[data-pomo="root"]'),
    taskList: $('[data-pomo="task-list"]'),
    listWrap: $('[data-pomo="task-list"]')?.parentElement,
    empty: $('[data-pomo="empty"]'),

    btnAdd: $('[data-pomo-action="add"]'),
    btnEdit: $('[data-pomo-action="edit"]'),
    btnDelete: $('[data-pomo-action="delete"]'),
    btnGo: $('[data-pomo-action="go"]'),

    btnCancel: $('[data-pomo-action="cancel"]'),
    btnConfirm: $('[data-pomo-action="confirm"]'),
    inputTitle: $('[data-pomo="task-name"]'),
    inputCycles: $('[data-pomo="cycle-input"]'),
    btnCycleInc: $('[data-pomo-action="cycle-inc"]'),
    btnCycleDec: $('[data-pomo-action="cycle-dec"]'),

    phase: $('[data-pomo="phase"]'),
    cycleCur: $('[data-pomo="cycle-cur"]'),
    cycleTotal: $('[data-pomo="cycle-total"]'),
    btnBack: $('[data-pomo-action="back"]'),
    btnStop: $('[data-pomo-action="stop"]'),
    btnPause: $('[data-pomo-action="pause"]'),
    runCard: $('[data-pomo="run-card"]'),
    confetti: $('[data-pomo="confetti"]')
};

const editDigits = {
    work: $$('[data-pomo-digit="work"]'),
    rest: $$('[data-pomo-digit="rest"]')
};

const runDigits = {
    mm: $$('[data-pomo-digit="run-mm"]'),
    ss: $$('[data-pomo-digit="run-ss"]')
};

const pomodoroState = {
    page: "list",
    taskList: [],
    index: 1,
    selectedTaskId: null,
    runningTaskId: null,
    editingTask: null,
    editingTaskId: null,
    editingMode: null,
    timer: {
        phase: "idle",
        status: "idle",
        cycleCur: 0,
        cycleTotal: 0,
        phaseRemainMs: 0,
        phaseTotalMs: 0,
        dueAt: 0,
        handle: null
    }
};
const runDisplayCache = {
    phase: "",
    status: "",
    cycleCur: -1,
    cycleTotal: -1,
    minute: -1,
    second: -1
};

function parseMinutesToMs(minutes) {
    return Math.max(0, Number(minutes) || 0) * 60000;
}

function parseMs(ms) {
    const safeMs = Math.max(0, Number(ms) || 0);
    return {
        minute: Math.floor(safeMs / 60000),
        second: Math.floor((safeMs % 60000) / 1000)
    };
}

function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getThemeText(key) {
    const map = {
        work: "WORK",
        rest: "REST",
        idle: "READY"
    };
    return map[key] || "READY";
}

function makeDefaultTask() {
    return {
        id: null,
        title: "新任务",
        workTime: parseMinutesToMs(25),
        restTime: parseMinutesToMs(5),
        repeatTimes: 4
    };
}

function normalizeTask(task) {
    const safeTask = task || {};
    return {
        id: Number.isFinite(Number(safeTask.id)) ? Number(safeTask.id) : null,
        title: typeof safeTask.title === "string" && safeTask.title.trim() ? safeTask.title.trim() : "新任务",
        workTime: clampNumber(Number(safeTask.workTime) || parseMinutesToMs(25), 0, parseMinutesToMs(99)),
        restTime: clampNumber(Number(safeTask.restTime) || parseMinutesToMs(5), 0, parseMinutesToMs(99)),
        repeatTimes: clampNumber(Number(safeTask.repeatTimes) || 1, 1, 99)
    };
}

function getTaskById(taskId) {
    return pomodoroState.taskList.find((task) => task.id === taskId) || null;
}

function saveTaskList() {
    return window.api.savePomodoroJson(pomodoroState.taskList);
}

function switchPage(page) {
    if (!["edit", "list", "run"].includes(page)) return;
    measureSync("pomodoro.switchPage", () => {
        dom.root.dataset.page = page;
        pomodoroState.page = page;
        dom.runCard?.__pomoWave?.setActive(page === "run");
    }, {page});
}

function switchPhase(phase) {
    dom.root.dataset.phase = phase;
    pomodoroState.timer.phase = phase;
    dom.phase.textContent = getThemeText(phase);
}

function switchStatus(status) {
    dom.root.dataset.status = status;
    pomodoroState.timer.status = status;

    if (status === "running") {
        dom.btnPause.textContent = "暂停";
        dom.btnPause.classList.remove("disabled");
    } else if (status === "paused") {
        dom.btnPause.textContent = "继续";
        dom.btnPause.classList.remove("disabled");
    } else if (status === "done") {
        dom.btnPause.textContent = "Congratulation!";
        dom.btnPause.classList.remove("disabled");
    } else {
        dom.btnPause.textContent = "Pause";
    }

    updateGoButtonState();
}

function setDigitValue(el, value) {
    el.style.setProperty("--pomo-digit", String(clampNumber(value, 0, 9)));
}

function setDigitGroup(els, value, width = els.length) {
    const safe = clampNumber(Number(value) || 0, 0, Math.pow(10, width) - 1);
    const chars = String(safe).padStart(width, "0").slice(-width).split("");
    els.forEach((el, index) => setDigitValue(el, Number(chars[index])));
}

function getDigitGroupValue(els) {
    return Number(els.map((el) => el.style.getPropertyValue("--pomo-digit") || "0").join(""));
}

function setEditMinutes(type, minutes) {
    setDigitGroup(editDigits[type], clampNumber(minutes, 0, 99), editDigits[type].length);
}

function getEditMinutes(type) {
    return getDigitGroupValue(editDigits[type]);
}

function setRunTimeDigits(minutes, seconds) {
    setDigitGroup(runDigits.mm, clampNumber(minutes, 0, 99), 2);
    setDigitGroup(runDigits.ss, clampNumber(seconds, 0, 59), 2);
}

function updateCycleInput(value) {
    dom.inputCycles.value = String(clampNumber(Number(value) || 1, 1, 99));
}

function updateCycleDisplay(cycleCur, cycleTotal) {
    dom.cycleCur.textContent = String(cycleCur || 0);
    dom.cycleTotal.textContent = String(cycleTotal || 0);
}

function lockEditingTask() {
    const title = dom.inputTitle.value.trim();
    const workMinutes = getEditMinutes("work");
    const restMinutes = getEditMinutes("rest");
    const cycles = clampNumber(Number(dom.inputCycles.value) || 1, 1, 99);
    const invalid = !title || workMinutes <= 0 || restMinutes <= 0 || cycles <= 0;
    dom.btnConfirm.classList.toggle("disabled", invalid);
}

function showEditingTask(task, mode = "edit") {
    const safeTask = normalizeTask(task);
    pomodoroState.editingTask = { ...safeTask };
    pomodoroState.editingTaskId = mode === "create" ? null : safeTask.id;
    pomodoroState.editingMode = mode;
    dom.inputTitle.value = safeTask.title;
    setEditMinutes("work", Math.floor(safeTask.workTime / 60000));
    setEditMinutes("rest", Math.floor(safeTask.restTime / 60000));
    updateCycleInput(safeTask.repeatTimes);
    lockEditingTask();
    switchPage("edit");
}

function clearTimerHandle() {
    if (pomodoroState.timer.handle) {
        clearInterval(pomodoroState.timer.handle);
        pomodoroState.timer.handle = null;
    }
}

function renderTaskList() {
    measureSync("pomodoro.renderTaskList", () => {
        dom.taskList.innerHTML = "";
        const fragment = document.createDocumentFragment();

        pomodoroState.taskList.forEach((task) => {
            const li = document.createElement("li");
            li.className = "pomoItem";
            li.dataset.taskId = String(task.id);
            li.draggable = false;

            if (pomodoroState.selectedTaskId === task.id) {
                li.classList.add("selected");
            }

            const handle = document.createElement("button");
            handle.type = "button";
            handle.className = "pomoItem__handle";
            handle.dataset.action = "drag";
            handle.innerHTML = `
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path fill="currentColor" d="M20 9H4v2h16V9zM4 15h16v-2H4v2z"></path>
                </svg>
            `;

            const title = document.createElement("span");
            title.className = "pomoItem__title";
            title.textContent = task.title;

            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "pomoIconBtn";
            editBtn.dataset.action = "edit";
            editBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2"></path>
                    <path d="M14 6l4 4" fill="none" stroke="currentColor" stroke-width="2"></path>
                </svg>
            `;

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "pomoIconBtn";
            deleteBtn.dataset.action = "delete";
            deleteBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M4 7h16" fill="none" stroke="currentColor" stroke-width="2"></path>
                    <path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2"></path>
                    <path d="M6 7l1-3h10l1 3" fill="none" stroke="currentColor" stroke-width="2"></path>
                    <path d="M7 7l1 14h8l1-14" fill="none" stroke="currentColor" stroke-width="2"></path>
                </svg>
            `;

            li.appendChild(handle);
            li.appendChild(title);
            li.appendChild(editBtn);
            li.appendChild(deleteBtn);
            fragment.appendChild(li);
        });
        dom.taskList.appendChild(fragment);

        const hasTasks = pomodoroState.taskList.length > 0;
        const hasSelectedTask = !!getTaskById(pomodoroState.selectedTaskId);
        dom.empty.style.display = hasTasks ? "none" : "grid";
        dom.btnEdit.classList.toggle("disabled", !hasSelectedTask);
        dom.btnDelete.classList.toggle("disabled", !hasSelectedTask);
        updateGoButtonState();
    }, {taskCount: pomodoroState.taskList.length});
}

function updateGoButtonState() {
    const hasSelectedTask = !!getTaskById(pomodoroState.selectedTaskId);
    const hasRunningTask = !!getTaskById(pomodoroState.runningTaskId) && pomodoroState.timer.status !== "idle";
    const shouldReturnRunningTask = hasRunningTask && pomodoroState.selectedTaskId === pomodoroState.runningTaskId;
    dom.btnGo.classList.toggle("disabled", !hasSelectedTask && !hasRunningTask);
    dom.btnGo.textContent = shouldReturnRunningTask ? "返回计时" : "GO";
}

function syncTaskOrderFromDom() {
    const ids = $$("[data-task-id]", dom.taskList).map((item) => Number(item.dataset.taskId));
    const taskMap = new Map(pomodoroState.taskList.map((task) => [task.id, task]));
    pomodoroState.taskList = ids.map((id) => taskMap.get(id)).filter(Boolean);
    saveTaskList();
}

function getDragAfterElement(container, y) {
    const items = $$(".pomoItem:not(.dragging)", container);
    let closest = null;
    let closestOffset = Number.NEGATIVE_INFINITY;

    items.forEach((item) => {
        const box = item.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closestOffset) {
            closestOffset = offset;
            closest = item;
        }
    });

    return closest;
}

function saveEditingTask() {
    if (!pomodoroState.editingTask) return;

    const nextTask = normalizeTask({
        ...pomodoroState.editingTask,
        title: dom.inputTitle.value.trim(),
        workTime: parseMinutesToMs(getEditMinutes("work")),
        restTime: parseMinutesToMs(getEditMinutes("rest")),
        repeatTimes: clampNumber(Number(dom.inputCycles.value) || 1, 1, 99)
    });
    const editingTaskId = pomodoroState.editingTaskId;
    const editingMode = pomodoroState.editingMode;

    if (editingMode === "create") {
        nextTask.id = pomodoroState.index++;
        pomodoroState.taskList.push(nextTask);
    } else {
        nextTask.id = editingTaskId;
        const index = pomodoroState.taskList.findIndex((task) => task.id === editingTaskId);
        if (index >= 0) {
            pomodoroState.taskList[index] = nextTask;
        } else {
            pomodoroState.taskList.push(nextTask);
        }
    }

    pomodoroState.selectedTaskId = nextTask.id;
    pomodoroState.editingTask = null;
    pomodoroState.editingTaskId = null;
    pomodoroState.editingMode = null;
    saveTaskList();
    renderTaskList();
    switchPage("list");
}

function deleteTask(taskId) {
    const task = getTaskById(taskId);
    if (!task) return;

    if (pomodoroState.runningTaskId === taskId) {
        clearRunningTask(false);
    }

    pomodoroState.taskList = pomodoroState.taskList.filter((item) => item.id !== taskId);

    if (pomodoroState.selectedTaskId === taskId) {
        pomodoroState.selectedTaskId = pomodoroState.taskList[0]?.id || null;
    }

    if (pomodoroState.editingTaskId === taskId) {
        pomodoroState.editingTask = null;
        pomodoroState.editingTaskId = null;
        pomodoroState.editingMode = null;
    }

    saveTaskList();
    renderTaskList();
}

function updateRunDisplay() {
    const remain = pomodoroState.timer.phaseRemainMs;
    const time = parseMs(remain);
    const phase = pomodoroState.timer.phase;
    const status = pomodoroState.timer.status;
    const cycleCur = pomodoroState.timer.cycleCur || 0;
    const cycleTotal = pomodoroState.timer.cycleTotal || 0;

    if (runDisplayCache.phase !== phase) {
        switchPhase(phase);
        runDisplayCache.phase = phase;
    }
    if (runDisplayCache.status !== status) {
        switchStatus(status);
        runDisplayCache.status = status;
    }
    if (runDisplayCache.cycleCur !== cycleCur || runDisplayCache.cycleTotal !== cycleTotal) {
        updateCycleDisplay(cycleCur, cycleTotal);
        runDisplayCache.cycleCur = cycleCur;
        runDisplayCache.cycleTotal = cycleTotal;
    }
    if (runDisplayCache.minute !== time.minute || runDisplayCache.second !== time.second) {
        setRunTimeDigits(time.minute, time.second);
        runDisplayCache.minute = time.minute;
        runDisplayCache.second = time.second;
    }

    if (dom.runCard.__pomoWave && pomodoroState.timer.phaseTotalMs > 0) {
        dom.runCard.__pomoWave.setProgress(remain / pomodoroState.timer.phaseTotalMs);
    }
}

function armTimer(remainMs) {
    clearTimerHandle();
    pomodoroState.timer.phaseRemainMs = remainMs;
    pomodoroState.timer.dueAt = Date.now() + remainMs;
    pomodoroState.timer.handle = setInterval(onTimerTick, 100);
}

function enterPhase(phase, durationMs) {
    pomodoroState.timer.phase = phase;
    pomodoroState.timer.phaseTotalMs = durationMs;
    pomodoroState.timer.phaseRemainMs = durationMs;
    pomodoroState.timer.status = "running";
    armTimer(durationMs);
    updateRunDisplay();
}

function finishRunningTask() {
    clearTimerHandle();
    pomodoroState.timer.phaseRemainMs = 0;
    pomodoroState.timer.phaseTotalMs = 1;
    pomodoroState.timer.status = "done";
    updateRunDisplay();
    switchPage("run");
}

function stepToNextPhase() {
    const task = getTaskById(pomodoroState.runningTaskId);
    if (!task) {
        clearRunningTask(false);
        return;
    }

    if (pomodoroState.timer.phase === "work") {
        enterPhase("rest", task.restTime);
        return;
    }

    if (pomodoroState.timer.cycleCur >= pomodoroState.timer.cycleTotal) {
        finishRunningTask();
        return;
    }

    pomodoroState.timer.cycleCur += 1;
    enterPhase("work", task.workTime);
}

function onTimerTick() {
    if (pomodoroState.timer.status !== "running") return;

    const remainMs = Math.max(0, pomodoroState.timer.dueAt - Date.now());
    pomodoroState.timer.phaseRemainMs = remainMs;
    updateRunDisplay();

    if (remainMs <= 0) {
        stepToNextPhase();
    }
}

function startTask(task) {
    const safeTask = normalizeTask(task);
    pomodoroState.runningTaskId = safeTask.id;
    pomodoroState.selectedTaskId = safeTask.id;
    pomodoroState.timer.cycleCur = 1;
    pomodoroState.timer.cycleTotal = safeTask.repeatTimes;
    enterPhase("work", safeTask.workTime);
    switchPage("run");
    renderTaskList();
}

function returnToRunningTask() {
    const runningTask = getTaskById(pomodoroState.runningTaskId);
    if (!runningTask) return;
    pomodoroState.selectedTaskId = runningTask.id;
    switchPage("run");
    updateRunDisplay();
    renderTaskList();
}

function pauseRunningTask() {
    if (pomodoroState.timer.status !== "running") return;
    pomodoroState.timer.phaseRemainMs = Math.max(0, pomodoroState.timer.dueAt - Date.now());
    clearTimerHandle();
    pomodoroState.timer.status = "paused";
    updateRunDisplay();
}

function resumeRunningTask() {
    if (pomodoroState.timer.status !== "paused") return;
    pomodoroState.timer.status = "running";
    armTimer(pomodoroState.timer.phaseRemainMs);
    updateRunDisplay();
}

function resetRunDisplay() {
    runDisplayCache.phase = "";
    runDisplayCache.status = "";
    runDisplayCache.cycleCur = -1;
    runDisplayCache.cycleTotal = -1;
    runDisplayCache.minute = -1;
    runDisplayCache.second = -1;
    pomodoroState.timer.phase = "idle";
    pomodoroState.timer.status = "idle";
    pomodoroState.timer.cycleCur = 0;
    pomodoroState.timer.cycleTotal = 0;
    pomodoroState.timer.phaseRemainMs = 0;
    pomodoroState.timer.phaseTotalMs = 1;
    pomodoroState.timer.dueAt = 0;
    setRunTimeDigits(0, 0);
    updateRunDisplay();
    if (dom.runCard.__pomoWave) {
        dom.runCard.__pomoWave.setProgress(1);
    }
}

function clearRunningTask(shouldReturnList = true) {
    clearTimerHandle();
    pomodoroState.runningTaskId = null;
    resetRunDisplay();
    updateGoButtonState();
    if (shouldReturnList) {
        switchPage("list");
    }
}

function burstConfetti() {
    dom.confetti.innerHTML = "";
    const count = 36;

    for (let i = 0; i < count; i++) {
        const item = document.createElement("span");
        item.className = "pomoConfetti__piece";
        item.style.left = `${Math.random() * 100}%`;
        item.style.top = `${10 + Math.random() * 20}%`;
        item.style.setProperty("--dx", `${-120 + Math.random() * 240}px`);
        item.style.setProperty("--dy", `${160 + Math.random() * 180}px`);
        item.style.setProperty("--rot", `${Math.random() * 540}deg`);
        item.style.setProperty("--delay", `${Math.random() * 120}ms`);
        item.style.setProperty("--color", ["#ff0055", "#ff9f1c", "#ffcc00", "#2ec4b6", "#3a86ff", "#8338ec"][i % 6]);
        dom.confetti.appendChild(item);
    }

    setTimeout(() => {
        dom.confetti.innerHTML = "";
        clearRunningTask(true);
    }, 1400);
}

async function initTaskList() {
    await measureAsync("pomodoro.initTaskList", async () => {
        const data = await window.api.loadPomodoroJson();
        pomodoroState.taskList = Array.isArray(data) ? data.map(normalizeTask) : [];
        pomodoroState.index = pomodoroState.taskList.length
            ? Math.max(...pomodoroState.taskList.map((task) => Number(task.id) || 0)) + 1
            : 1;
        pomodoroState.selectedTaskId = pomodoroState.taskList[0]?.id || null;
    });
}

function bindEditableDigit(el, onChange) {
    el.addEventListener("contextmenu", (event) => {
        event.preventDefault();
    });

    el.addEventListener("mousedown", (event) => {
        if (event.button !== 0 && event.button !== 2) return;
        const current = Number(el.style.getPropertyValue("--pomo-digit")) || 0;
        const next = event.button === 0 ? (current + 1) % 10 : (current + 9) % 10;
        setDigitValue(el, next);
        onChange();
    });

    el.addEventListener("wheel", (event) => {
        event.preventDefault();
        const current = Number(el.style.getPropertyValue("--pomo-digit")) || 0;
        const next = event.deltaY < 0 ? (current + 1) % 10 : (current + 9) % 10;
        setDigitValue(el, next);
        onChange();
    }, { passive: false });
}

function wireEditPanel() {
    dom.btnCancel.addEventListener("click", () => {
        pomodoroState.editingTask = null;
        pomodoroState.editingTaskId = null;
        pomodoroState.editingMode = null;
        switchPage("list");
    });

    dom.btnConfirm.addEventListener("click", () => {
        if (dom.btnConfirm.classList.contains("disabled")) return;
        saveEditingTask();
    });

    dom.inputTitle.addEventListener("input", lockEditingTask);

    dom.btnCycleInc.addEventListener("click", () => {
        updateCycleInput(Number(dom.inputCycles.value) + 1);
        lockEditingTask();
    });

    dom.btnCycleDec.addEventListener("click", () => {
        updateCycleInput(Number(dom.inputCycles.value) - 1);
        lockEditingTask();
    });

    dom.inputCycles.addEventListener("wheel", (event) => {
        event.preventDefault();
        updateCycleInput(Number(dom.inputCycles.value) + (event.deltaY < 0 ? 1 : -1));
        lockEditingTask();
    }, { passive: false });

    [...editDigits.work, ...editDigits.rest].forEach((el) => bindEditableDigit(el, lockEditingTask));
}

function wireListPanel() {
    dom.btnAdd.addEventListener("click", () => {
        pomodoroState.editingTask = null;
        pomodoroState.editingTaskId = null;
        pomodoroState.editingMode = "create";
        pomodoroState.selectedTaskId = null;
        showEditingTask(makeDefaultTask(), "create");
    });

    dom.btnEdit.addEventListener("click", () => {
        const task = getTaskById(pomodoroState.selectedTaskId);
        if (!task) return;
        showEditingTask(task, "edit");
    });

    dom.btnDelete.addEventListener("click", () => {
        if (!getTaskById(pomodoroState.selectedTaskId)) return;
        deleteTask(pomodoroState.selectedTaskId);
    });

    dom.btnGo.addEventListener("click", () => {
        const shouldReturnRunningTask = pomodoroState.runningTaskId != null
            && pomodoroState.selectedTaskId === pomodoroState.runningTaskId
            && pomodoroState.timer.status !== "idle";
        if (shouldReturnRunningTask) {
            returnToRunningTask();
            return;
        }
        const task = getTaskById(pomodoroState.selectedTaskId);
        if (!task) return;
        startTask(task);
    });

    dom.taskList.addEventListener("click", (event) => {
        const item = event.target.closest(".pomoItem");
        if (!item) return;

        const taskId = Number(item.dataset.taskId);
        const actionBtn = event.target.closest("[data-action]");

        pomodoroState.selectedTaskId = taskId;

        if (!actionBtn) {
            renderTaskList();
            return;
        }

        const action = actionBtn.dataset.action;

        if (action === "edit") {
            const task = getTaskById(taskId);
            if (task) showEditingTask(task, "edit");
            return;
        }

        if (action === "delete") {
            deleteTask(taskId);
            return;
        }

        renderTaskList();
    });

    if (dom.listWrap) {
        dom.listWrap.addEventListener("click", (event) => {
            const clickedItem = event.target.closest(".pomoItem");
            if (clickedItem) return;
            pomodoroState.selectedTaskId = null;
            renderTaskList();
        });
    }

    dom.taskList.addEventListener("dblclick", (event) => {
        const item = event.target.closest(".pomoItem");
        if (!item) return;
        const task = getTaskById(Number(item.dataset.taskId));
        if (task) startTask(task);
    });

    dom.taskList.addEventListener("dragstart", (event) => {
        const item = event.target.closest(".pomoItem");
        if (!item || event.target.closest('[data-action="drag"]') == null) {
            event.preventDefault();
            return;
        }
        item.classList.add("dragging");
    });

    dom.taskList.addEventListener("dragend", (event) => {
        const item = event.target.closest(".pomoItem");
        if (!item) return;
        item.classList.remove("dragging");
        syncTaskOrderFromDom();
        renderTaskList();
    });

    dom.taskList.addEventListener("dragover", (event) => {
        event.preventDefault();
        const dragging = $(".dragging", dom.taskList);
        if (!dragging) return;
        const after = getDragAfterElement(dom.taskList, event.clientY);
        if (after) {
            dom.taskList.insertBefore(dragging, after);
        } else {
            dom.taskList.appendChild(dragging);
        }
    });

    dom.taskList.addEventListener("mousedown", (event) => {
        const handle = event.target.closest('[data-action="drag"]');
        const item = event.target.closest(".pomoItem");
        if (!item) return;
        item.draggable = !!handle;
    });

    dom.taskList.addEventListener("mouseup", () => {
        $$(".pomoItem", dom.taskList).forEach((item) => {
            item.draggable = false;
        });
    });
}

function wireRunPanel() {
    dom.btnBack.addEventListener("click", () => {
        pomodoroState.selectedTaskId = pomodoroState.runningTaskId;
        switchPage("list");
        renderTaskList();
    });

    dom.btnStop.addEventListener("click", () => {
        clearRunningTask(true);
    });

    dom.btnPause.addEventListener("click", () => {
        if (pomodoroState.timer.status === "running") {
            pauseRunningTask();
            return;
        }

        if (pomodoroState.timer.status === "paused") {
            resumeRunningTask();
            return;
        }

        if (pomodoroState.timer.status === "done") {
            burstConfetti();
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    await initTaskList();

    dom.runCard.__pomoWave = new PomoWaveEngine(dom.runCard);
    dom.runCard.__pomoWave.setProgress(1);

    wireEditPanel();
    wireListPanel();
    wireRunPanel();

    resetRunDisplay();
    renderTaskList();
    updateGoButtonState();
    switchPage("list");
});

class PomoWaveEngine {
    constructor(cardEl) {
        this.card = cardEl;
        this.canvas = cardEl.querySelector('[data-pomo="wave-canvas"]');
        this.rainbow = cardEl.querySelector('[data-pomo="rainbow-border"]');
        this.ctx = this.canvas.getContext("2d");
        this.progress = 1;
        this.target = 1;
        this.T = 0;
        this.lastNow = null;
        this.W = 0;
        this.H = 0;
        this.active = false;
        this.rafId = 0;
        this.COLORS = ["#ff0055", "#ff6600", "#ffcc00", "#00ff99", "#0099ff", "#cc33ff", "#ff0055"];
        this.LAYERS = [
            {
                comps: [
                    { amp: 14, freq: 0.018, speed: 0.55 },
                    { amp: 5, freq: 0.042, speed: 0.8 }
                ],
                lineWidth: 3.5,
                alpha: 1,
                blur: 0,
                isMaster: true
            },
            {
                comps: [
                    { amp: 10, freq: 0.022, speed: -0.45 },
                    { amp: 4, freq: 0.055, speed: -0.7 }
                ],
                lineWidth: 2.5,
                alpha: 0.55,
                blur: 1,
                isMaster: false
            },
            {
                comps: [
                    { amp: 5, freq: 0.06, speed: 1.1 },
                    { amp: 2, freq: 0.09, speed: 1.4 }
                ],
                lineWidth: 1.5,
                alpha: 0.3,
                blur: 0.5,
                isMaster: false
            }
        ];

        this.resize();
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(cardEl);
        this.visibilityHandler = () => {
            if (document.hidden) {
                this.lastNow = null;
                this.stopLoop();
                return;
            }
            if (this.active) {
                this.startLoop();
            }
        };
        document.addEventListener("visibilitychange", this.visibilityHandler);
        this.setActive(false);
    }

    setProgress(progress) {
        this.target = clampNumber(progress, 0, 1);
    }

    setActive(active) {
        this.active = Boolean(active);
        if (!this.active) {
            this.stopLoop();
            return;
        }
        this.lastNow = null;
        this.startLoop();
    }

    startLoop() {
        if (this.rafId || !this.active || document.hidden) {
            return;
        }
        this.rafId = requestAnimationFrame((time) => this.tick(time));
    }

    stopLoop() {
        if (!this.rafId) {
            return;
        }
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
    }

    resize() {
        const rect = this.card.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.W = rect.width;
        this.H = rect.height;
        this.canvas.width = Math.round(this.W * dpr);
        this.canvas.height = Math.round(this.H * dpr);
        this.canvas.style.width = `${this.W}px`;
        this.canvas.style.height = `${this.H}px`;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(dpr, dpr);
    }

    layerY(layer, x, baseY) {
        return layer.comps.reduce((sum, comp) => {
            return sum + comp.amp * Math.sin(comp.freq * x + comp.speed * this.T * Math.PI * 2);
        }, baseY);
    }

    buildPath(points) {
        const { ctx } = this;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
            const mx = (points[i].x + points[i + 1].x) / 2;
            const my = (points[i].y + points[i + 1].y) / 2;
            ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    }

    drawFluidFill(points) {
        const { ctx, H, W } = this;
        ctx.save();
        const avgY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
        const grad = ctx.createLinearGradient(0, avgY - 20, 0, H);
        grad.addColorStop(0, "rgba(120, 80, 255, 0.18)");
        grad.addColorStop(0.25, "rgba(60, 80, 200, 0.12)");
        grad.addColorStop(0.6, "rgba(20, 20, 80, 0.07)");
        grad.addColorStop(1, "rgba(0, 0, 0, 0)");
        this.buildPath(points);
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
    }

    drawFluidGlow(points) {
        const { ctx, W } = this;
        ctx.save();
        ctx.filter = "blur(8px)";
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 18;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        this.COLORS.forEach((color, index) => {
            grad.addColorStop(index / (this.COLORS.length - 1), color);
        });
        ctx.strokeStyle = grad;
        this.buildPath(points.map((point) => ({ x: point.x, y: point.y + 6 })));
        ctx.stroke();
        ctx.restore();
    }

    drawLayer(layer, points) {
        const { ctx, W } = this;
        ctx.save();
        if (layer.blur > 0) ctx.filter = `blur(${layer.blur}px)`;
        ctx.globalAlpha = layer.alpha;
        ctx.lineWidth = layer.lineWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        this.COLORS.forEach((color, index) => {
            grad.addColorStop(index / (this.COLORS.length - 1), color);
        });
        ctx.strokeStyle = grad;
        this.buildPath(points);
        ctx.stroke();
        ctx.restore();
    }

    syncClip(points) {
        const stride = Math.max(1, Math.floor(points.length / 80));
        const polygon = [];

        for (let i = 0; i < points.length; i += stride) {
            polygon.push(`${(points[i].x / this.W * 100).toFixed(2)}% ${(points[i].y / this.H * 100).toFixed(2)}%`);
        }

        const last = points[points.length - 1];
        polygon.push(`${(last.x / this.W * 100).toFixed(2)}% ${(last.y / this.H * 100).toFixed(2)}%`);
        polygon.push("100% 100%");
        polygon.push("0% 100%");
        this.rainbow.style.clipPath = `polygon(${polygon.join(",")})`;
    }

    tick(now) {
        this.rafId = 0;
        if (!this.active || document.hidden) {
            return;
        }
        if (!this.lastNow) this.lastNow = now;
        const dt = Math.min((now - this.lastNow) / 1000, 0.05);
        this.lastNow = now;
        this.T += dt;
        this.progress += (this.target - this.progress) * Math.min(dt * 6, 1);

        const { ctx, H, W } = this;
        if (!W || !H) {
            this.startLoop();
            return;
        }
        ctx.clearRect(0, 0, W, H);

        const baseY = (1 - this.progress) * H;
        const layerPoints = this.LAYERS.map((layer) => {
            const points = [];
            for (let x = 0; x <= W; x += 3) {
                points.push({ x, y: this.layerY(layer, x, baseY) });
            }
            if (points[points.length - 1].x < W) {
                points.push({ x: W, y: this.layerY(layer, W, baseY) });
            }
            return points;
        });

        const master = layerPoints[this.LAYERS.findIndex((layer) => layer.isMaster)];
        this.drawFluidFill(master);
        this.drawFluidGlow(master);
        this.LAYERS.forEach((layer, index) => this.drawLayer(layer, layerPoints[index]));
        this.syncClip(master);

        this.startLoop();
    }
}
