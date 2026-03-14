import { escapeHtml } from "../shared/dom.js";

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
const VIEW_TRANSITION_MS = 180;
const CALENDAR_SYNC_THROTTLE_MS = 3000;

const calendarState = {
    currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDate: "",
    data: {
        todos: [],
        aiDiaries: [],
        holidays: [],
    },
    loaded: false,
    lastSyncedAt: 0,
    syncTimer: null,
    lastMonthKey: "",
    clickTimer: null,
};

const dom = {
    root: document.querySelector(".calendar-root"),
    title: document.querySelector('[data-role="calendar-title"]'),
    prevMonth: document.querySelector('[data-role="calendar-prev-month"]'),
    nextMonth: document.querySelector('[data-role="calendar-next-month"]'),
    jumpDate: document.querySelector('[data-role="calendar-jump-date"]'),
    jumpToday: document.querySelector('[data-role="calendar-jump-today"]'),
    jumpDateBtn: document.querySelector('[data-role="calendar-jump-date-btn"]'),
    gridHead: document.querySelector('[data-role="calendar-grid-head"]'),
    grid: document.querySelector('[data-role="calendar-grid"]'),
    modal: document.querySelector('[data-role="calendar-modal"]'),
    modalTitle: document.querySelector('[data-role="calendar-modal-title"]'),
    modalMeta: document.querySelector('[data-role="calendar-modal-meta"]'),
    modalBadges: document.querySelector('[data-role="calendar-modal-badges"]'),
    todoList: document.querySelector('[data-role="calendar-todo-list"]'),
    diaryList: document.querySelector('[data-role="calendar-diary-list"]'),
    addTodo: document.querySelector('[data-role="calendar-add-todo"]'),
};

function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function parseDateKey(dateText) {
    const [year, month, day] = String(dateText || "").split("-").map((item) => Number(item));
    return new Date(year, (month || 1) - 1, day || 1);
}

function monthLabel(date) {
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

function getMonthGridDates(monthDate) {
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    const startWeekday = monthStart.getDay();
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - startWeekday);

    const dates = [];
    for (let index = 0; index < 42; index += 1) {
        const date = new Date(gridStart);
        date.setDate(gridStart.getDate() + index);
        dates.push({
            key: formatDateKey(date),
            date,
            inCurrentMonth: date >= monthStart && date <= monthEnd,
        });
    }
    return dates;
}

function buildDateIndex(items = []) {
    return items.reduce((map, item) => {
        const key = String(item?.date || "").trim();
        if (!key) return map;
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key).push(item);
        return map;
    }, new Map());
}

function isDateKeyText(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function shiftDateKey(dateKey, offsetDays = 0) {
    const date = parseDateKey(dateKey);
    date.setDate(date.getDate() + Number(offsetDays || 0));
    return formatDateKey(date);
}

function ensureHolidayDayState(index, dateKey) {
    if (!index.has(dateKey)) {
        index.set(dateKey, {
            holidays: [],
            holidayIds: new Set(),
            hasHolidayBackground: false,
            holidayBadgeNames: new Set(),
        });
    }
    return index.get(dateKey);
}

function normalizeHolidayRange(item) {
    const name = String(item?.name || "").trim() || "节日";
    const type = String(item?.type || "").trim() || "public";
    const source = String(item?.source || "").trim() || "builtin";

    const rawDate = String(item?.date || "").trim();
    const rawStartDate = String(item?.startDate || "").trim();
    const rawEndDate = String(item?.endDate || "").trim();
    const startDate = rawStartDate || rawDate || rawEndDate;
    const endDate = rawEndDate || rawDate || rawStartDate;
    if (!isDateKeyText(startDate) || !isDateKeyText(endDate) || endDate < startDate) {
        return null;
    }
    return {
        item,
        name,
        type,
        source,
        startDate,
        endDate,
    };
}

function buildHolidayDateIndex(items = []) {
    const dateIndex = new Map();
    const groupedRanges = new Map();

    for (const item of items) {
        const range = normalizeHolidayRange(item);
        if (!range) {
            continue;
        }
        const groupKey = `${range.name}::${range.type}::${range.source}`;
        if (!groupedRanges.has(groupKey)) {
            groupedRanges.set(groupKey, []);
        }
        groupedRanges.get(groupKey).push(range);

        let cursor = range.startDate;
        const holidayId = String(item?.id || `${range.startDate}_${range.endDate}-${range.name}`).trim();
        while (cursor <= range.endDate) {
            const dayState = ensureHolidayDayState(dateIndex, cursor);
            if (!dayState.holidayIds.has(holidayId)) {
                dayState.holidayIds.add(holidayId);
                dayState.holidays.push(item);
            }
            cursor = shiftDateKey(cursor, 1);
        }
    }

    for (const ranges of groupedRanges.values()) {
        ranges.sort((a, b) => a.startDate.localeCompare(b.startDate, "zh-CN") || a.endDate.localeCompare(b.endDate, "zh-CN"));
        const mergedRanges = [];
        for (const range of ranges) {
            const last = mergedRanges[mergedRanges.length - 1];
            if (!last) {
                mergedRanges.push({
                    startDate: range.startDate,
                    endDate: range.endDate,
                    name: range.name,
                });
                continue;
            }
            const contiguousDate = shiftDateKey(last.endDate, 1);
            if (range.startDate <= contiguousDate) {
                if (range.endDate > last.endDate) {
                    last.endDate = range.endDate;
                }
                continue;
            }
            mergedRanges.push({
                startDate: range.startDate,
                endDate: range.endDate,
                name: range.name,
            });
        }

        for (const range of mergedRanges) {
            let cursor = range.startDate;
            let isFirstDay = true;
            while (cursor <= range.endDate) {
                const dayState = ensureHolidayDayState(dateIndex, cursor);
                dayState.hasHolidayBackground = true;
                if (isFirstDay) {
                    dayState.holidayBadgeNames.add(range.name || "节日");
                    isFirstDay = false;
                }
                cursor = shiftDateKey(cursor, 1);
            }
        }
    }

    for (const dayState of dateIndex.values()) {
        delete dayState.holidayIds;
    }
    return dateIndex;
}

function buildCalendarIndexes() {
    return {
        todoIndex: buildDateIndex(calendarState.data.todos),
        diaryIndex: buildDateIndex(calendarState.data.aiDiaries),
        holidayIndex: buildHolidayDateIndex(calendarState.data.holidays),
    };
}

function getDateDetailFromState(dateKey, indexes = buildCalendarIndexes()) {
    const holidayState = indexes.holidayIndex.get(dateKey);
    return {
        date: dateKey,
        todos: indexes.todoIndex.get(dateKey) || [],
        aiDiaries: indexes.diaryIndex.get(dateKey) || [],
        holidays: holidayState?.holidays || [],
    };
}

function getHolidayFlagsForDate(dateKey, indexes = buildCalendarIndexes()) {
    const holidayState = indexes.holidayIndex.get(dateKey);
    return {
        hasHolidayBackground: Boolean(holidayState?.hasHolidayBackground),
        holidayBadgeNames: holidayState ? [...holidayState.holidayBadgeNames] : [],
    };
}

function renderGridHead() {
    if (!dom.gridHead) return;
    dom.gridHead.innerHTML = WEEKDAY_NAMES.map((name) => `<div class="calendar-gridHeadCell">${name}</div>`).join("");
}

function getBadgesForDate(dateKey, indexes = buildCalendarIndexes()) {
    const detail = getDateDetailFromState(dateKey, indexes);
    const holidayFlags = getHolidayFlagsForDate(dateKey, indexes);
    const badges = [];
    if (detail.todos.length) {
        const doneCount = detail.todos.filter((item) => item.status === "done").length;
        badges.push({type: "todo", text: `待办 ${doneCount}/${detail.todos.length}`});
    }
    if (detail.aiDiaries.length) {
        badges.push({type: "diary", text: `AI日记 ${detail.aiDiaries.length}`});
    }
    for (const holidayName of holidayFlags.holidayBadgeNames) {
        badges.push({type: "holiday", text: holidayName || "节日"});
    }
    return badges;
}

function renderCalendarGrid() {
    if (!dom.grid || !dom.title) return;

    const monthKey = `${calendarState.currentMonth.getFullYear()}-${calendarState.currentMonth.getMonth() + 1}`;
    const monthChanged = calendarState.lastMonthKey && calendarState.lastMonthKey !== monthKey;
    calendarState.lastMonthKey = monthKey;
    dom.title.textContent = `日历计划 · ${monthLabel(calendarState.currentMonth)}`;

    const indexes = buildCalendarIndexes();
    const todayKey = formatDateKey(new Date());
    const cells = getMonthGridDates(calendarState.currentMonth);
    dom.grid.innerHTML = cells.map(({key, date, inCurrentMonth}) => {
        const badges = getBadgesForDate(key, indexes);
        const holidayFlags = getHolidayFlagsForDate(key, indexes);
        const hasHoliday = holidayFlags.hasHolidayBackground;
        const day = date.getDay();
        const isWeekend = day === 0 || day === 6;
        const selected = calendarState.selectedDate === key;
        const isToday = key === todayKey;
        return `
            <article
                class="calendar-cell${inCurrentMonth ? "" : " is-outside"}${hasHoliday ? " is-holiday" : ""}${isWeekend && !hasHoliday ? " is-weekend" : ""}${selected ? " is-selected" : ""}${isToday ? " is-today" : ""}"
                data-role="calendar-cell"
                data-date="${key}"
                tabindex="0"
            >
                <div class="calendar-cell__day">
                    <span class="calendar-cell__dayNumber">${date.getDate()}</span>
                    ${badges.length ? '<span class="calendar-cell__dot"></span>' : ""}
                </div>
                <div class="calendar-cell__badges">
                    ${badges.slice(0, 3).map((badge) => `<span class="calendar-badge calendar-badge--${badge.type}">${escapeHtml(badge.text)}</span>`).join("")}
                </div>
            </article>
        `;
    }).join("");
    dom.grid.classList.toggle("is-switching", monthChanged);
}

function renderBlankCard() {
    return `
        <article class="calendar-record calendar-record--empty">
            <div class="calendar-record__blank"></div>
        </article>
    `;
}

function renderModalBadges(detail) {
    if (!dom.modalBadges) return;
    const holidayNameBadges = detail.holidays
        .slice(0, 4)
        .map((item) => `<span class="calendar-badge calendar-badge--holiday">${escapeHtml(item.name || "节日")}</span>`);
    dom.modalBadges.innerHTML = [
        `<span class="calendar-badge calendar-badge--todo">待办 ${detail.todos.length}</span>`,
        `<span class="calendar-badge calendar-badge--diary">AI日记 ${detail.aiDiaries.length}</span>`,
        `<span class="calendar-badge calendar-badge--holiday">节假日 ${detail.holidays.length}</span>`,
        ...holidayNameBadges,
    ].join("");
}

function renderTodoList(detail) {
    if (!dom.todoList) return;
    if (!detail.todos.length) {
        dom.todoList.innerHTML = renderBlankCard();
        return;
    }
    dom.todoList.innerHTML = `
        <section class="calendar-todoTable" aria-label="待办事项列表">
            <header class="calendar-todoTable__head">
                <span class="calendar-todoTable__cell calendar-todoTable__cell--status">状态</span>
                <span class="calendar-todoTable__cell calendar-todoTable__cell--content">事项</span>
                <span class="calendar-todoTable__cell calendar-todoTable__cell--priority">优先级</span>
                <span class="calendar-todoTable__cell calendar-todoTable__cell--time">更新时间</span>
                <span class="calendar-todoTable__cell calendar-todoTable__cell--actions">操作</span>
            </header>
            <div class="calendar-todoTable__body">
                ${detail.todos.map((item) => `
                    <article class="calendar-todoTable__row" data-status="${escapeHtml(item.status || "todo")}">
                        <div class="calendar-todoTable__cell calendar-todoTable__cell--status">
                            <span class="calendar-todoStatus" data-status="${escapeHtml(item.status || "todo")}">
                                <span class="calendar-todoStatus__check">${item.status === "done" ? "✓" : ""}</span>
                                <span class="calendar-todoStatus__label">${item.status === "done" ? "已完成" : "待处理"}</span>
                            </span>
                        </div>
                        <div class="calendar-todoTable__cell calendar-todoTable__cell--content">
                            <h6 class="calendar-record__title">${escapeHtml(item.title)}</h6>
                            ${item.description ? `<p class="calendar-record__body">${escapeHtml(item.description)}</p>` : `<p class="calendar-record__body calendar-record__body--muted">暂无补充说明</p>`}
                        </div>
                        <div class="calendar-todoTable__cell calendar-todoTable__cell--priority">
                            <span class="calendar-priorityTag">${escapeHtml(item.priority || "medium")}</span>
                        </div>
                        <div class="calendar-todoTable__cell calendar-todoTable__cell--time">
                            <span class="calendar-todoTable__timeText">${escapeHtml(item.updatedAt || item.createdAt || "") || "未记录"}</span>
                        </div>
                        <div class="calendar-todoTable__cell calendar-todoTable__cell--actions">
                            <div class="calendar-record__actions">
                                <button type="button" class="calendar-record__btn" data-action="toggle-todo" data-id="${escapeHtml(item.id)}">${item.status === "done" ? "改为未完成" : "标记完成"}</button>
                                <button type="button" class="calendar-record__btn" data-action="edit-todo" data-id="${escapeHtml(item.id)}">编辑</button>
                                <button type="button" class="calendar-record__btn" data-action="delete-todo" data-id="${escapeHtml(item.id)}">删除</button>
                            </div>
                        </div>
                    </article>
                `).join("")}
            </div>
        </section>
    `;
}

function renderDiaryList(detail) {
    if (!dom.diaryList) return;
    if (!detail.aiDiaries.length) {
        dom.diaryList.innerHTML = renderBlankCard();
        return;
    }
    dom.diaryList.innerHTML = detail.aiDiaries.map((item) => `
        <article class="calendar-record">
            <div class="calendar-record__head">
                <h6 class="calendar-record__title">${escapeHtml(item.title || "AI 日记")}</h6>
                <span class="calendar-badge calendar-badge--diary">${escapeHtml(item.mood || "记录")}</span>
            </div>
            <p class="calendar-record__meta">更新时间：${escapeHtml(item.updatedAt || item.createdAt || "")}</p>
            <p class="calendar-record__body">${escapeHtml(item.content || "")}</p>
            <div class="calendar-record__actions">
                <button type="button" class="calendar-record__btn" data-action="edit-diary" data-id="${escapeHtml(item.id)}">编辑</button>
            </div>
        </article>
    `).join("");
}

async function openDateDetail(dateKey) {
    if (!dom.modal || !dom.modalTitle || !dom.modalMeta) return;
    calendarState.selectedDate = dateKey;
    renderCalendarGrid();

    let detail = getDateDetailFromState(dateKey, buildCalendarIndexes());
    if (window.api?.getCalendarDayDetail) {
        try {
            detail = await window.api.getCalendarDayDetail(dateKey);
        } catch (error) {
            console.error(error);
        }
    }

    const date = parseDateKey(dateKey);
    dom.modalTitle.textContent = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    dom.modalMeta.textContent = `待办 ${detail.todos.length} 条 · AI日记 ${detail.aiDiaries.length} 条 · 节假日 ${detail.holidays.length} 条`;
    renderModalBadges(detail);
    renderTodoList(detail);
    renderDiaryList(detail);
    dom.modal.hidden = false;
}

function closeModal() {
    if (dom.modal) {
        dom.modal.hidden = true;
    }
}

async function syncCalendarData() {
    if (!window.api?.loadCalendarPlan) return;
    const data = await window.api.loadCalendarPlan();
    calendarState.data = {
        todos: Array.isArray(data?.todos) ? data.todos : [],
        aiDiaries: Array.isArray(data?.aiDiaries) ? data.aiDiaries : [],
        holidays: Array.isArray(data?.holidays) ? data.holidays : [],
    };
    calendarState.loaded = true;
    calendarState.lastSyncedAt = Date.now();
    renderCalendarGrid();
}

async function reloadAndRefreshModal() {
    await syncCalendarData();
    if (calendarState.selectedDate && dom.modal && !dom.modal.hidden) {
        await openDateDetail(calendarState.selectedDate);
    }
}

function findTodoById(id) {
    return calendarState.data.todos.find((item) => item.id === id) || null;
}

function findDiaryById(id) {
    return calendarState.data.aiDiaries.find((item) => item.id === id) || null;
}

async function handleTodoAction(action, id) {
    const todo = findTodoById(id);
    if (!todo) return;

    if (action === "toggle-todo") {
        await window.api.updateCalendarTodo({
            id: todo.id,
            status: todo.status === "done" ? "todo" : "done",
        });
        await reloadAndRefreshModal();
        return;
    }
    if (action === "edit-todo") {
        const nextTitle = window.prompt("编辑待办标题", todo.title || "");
        if (nextTitle == null) return;
        const nextDesc = window.prompt("编辑待办描述", todo.description || "") || "";
        await window.api.updateCalendarTodo({
            id: todo.id,
            title: nextTitle,
            description: nextDesc,
        });
        await reloadAndRefreshModal();
        return;
    }
    if (action === "delete-todo") {
        if (!window.confirm(`确认删除待办：${todo.title}？`)) return;
        await window.api.deleteCalendarTodo(todo.id);
        await reloadAndRefreshModal();
    }
}

async function handleDiaryAction(action, id) {
    const diary = findDiaryById(id);
    if (!diary) return;

    if (action === "edit-diary") {
        const title = window.prompt("编辑日记标题", diary.title || "AI 日记");
        if (title == null) return;
        const content = window.prompt("编辑日记内容", diary.content || "");
        if (content == null) return;
        await window.api.updateAiDiary({
            id: diary.id,
            title,
            content,
            mood: diary.mood || "",
        });
        await reloadAndRefreshModal();
        return;
    }
}

function jumpToDate(dateKey, openModal = true) {
    if (!dateKey) return;
    const target = parseDateKey(dateKey);
    calendarState.currentMonth = new Date(target.getFullYear(), target.getMonth(), 1);
    calendarState.selectedDate = dateKey;
    renderCalendarGrid();
    if (dom.jumpDate) {
        dom.jumpDate.value = dateKey;
    }
    if (openModal) {
        openDateDetail(dateKey).catch((error) => console.error(error));
    }
}

function selectDate(dateKey) {
    if (!dateKey) return;
    calendarState.selectedDate = dateKey;
    if (dom.jumpDate) {
        dom.jumpDate.value = dateKey;
    }
    renderCalendarGrid();
}

function wireJumpActions() {
    dom.jumpToday?.addEventListener("click", () => {
        jumpToDate(formatDateKey(new Date()));
    });
    dom.jumpDateBtn?.addEventListener("click", () => {
        const value = String(dom.jumpDate?.value || "").trim();
        if (!value) return;
        jumpToDate(value);
    });
    dom.jumpDate?.addEventListener("change", () => {
        const value = String(dom.jumpDate?.value || "").trim();
        if (!value) return;
        jumpToDate(value);
    });
}

function wireMonthActions() {
    dom.prevMonth?.addEventListener("click", () => {
        calendarState.currentMonth = new Date(calendarState.currentMonth.getFullYear(), calendarState.currentMonth.getMonth() - 1, 1);
        renderCalendarGrid();
    });
    dom.nextMonth?.addEventListener("click", () => {
        calendarState.currentMonth = new Date(calendarState.currentMonth.getFullYear(), calendarState.currentMonth.getMonth() + 1, 1);
        renderCalendarGrid();
    });
}

function wireGridActions() {
    dom.grid?.addEventListener("click", (event) => {
        const cell = event.target.closest('[data-role="calendar-cell"]');
        if (!cell) return;
        const date = cell.dataset.date || "";
        if (!date) return;
        if (calendarState.clickTimer) {
            clearTimeout(calendarState.clickTimer);
            calendarState.clickTimer = null;
        }
        if (event.detail >= 2) {
            jumpToDate(date, true);
            return;
        }
        calendarState.clickTimer = window.setTimeout(() => {
            calendarState.clickTimer = null;
            selectDate(date);
        }, 220);
    });

    dom.grid?.addEventListener("keydown", (event) => {
        const cell = event.target.closest('[data-role="calendar-cell"]');
        if (!cell) return;
        if (event.key === " ") {
            event.preventDefault();
            const date = cell.dataset.date || "";
            if (!date) return;
            selectDate(date);
            return;
        }
        if (event.key !== "Enter") return;
        event.preventDefault();
        const date = cell.dataset.date || "";
        if (!date) return;
        jumpToDate(date, true);
    });
}

function wireModalActions() {
    dom.modal?.addEventListener("click", (event) => {
        if (event.target.closest('[data-role="calendar-close"]')) {
            closeModal();
            return;
        }
        const btn = event.target.closest(".calendar-record__btn");
        if (!btn) return;
        const action = btn.dataset.action || "";
        const id = btn.dataset.id || "";
        if (!action || !id) return;
        if (action.includes("todo")) {
            handleTodoAction(action, id).catch((error) => console.error(error));
            return;
        }
        if (action.includes("diary")) {
            handleDiaryAction(action, id).catch((error) => console.error(error));
        }
    });

    dom.addTodo?.addEventListener("click", async () => {
        const date = calendarState.selectedDate || formatDateKey(new Date());
        const title = window.prompt("输入待办标题", "");
        if (!title) return;
        const description = window.prompt("输入待办描述（可选）", "") || "";
        const priorityInput = String(window.prompt("优先级（low/medium/high）", "medium") || "medium").trim().toLowerCase();
        const priority = ["low", "medium", "high"].includes(priorityInput) ? priorityInput : "medium";
        await window.api.createCalendarTodo({
            title,
            description,
            priority,
            date,
            status: "todo",
        });
        await reloadAndRefreshModal();
    });

    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && dom.modal && !dom.modal.hidden) {
            closeModal();
        }
    });
}

function wireViewSync() {
    window.addEventListener("shell:viewchange", (event) => {
        if (event.detail?.viewKey !== "calendar") return;
        if (calendarState.syncTimer) {
            clearTimeout(calendarState.syncTimer);
            calendarState.syncTimer = null;
        }
        const dueToStale = !calendarState.loaded || (Date.now() - calendarState.lastSyncedAt >= CALENDAR_SYNC_THROTTLE_MS);
        if (!dueToStale) {
            renderCalendarGrid();
            return;
        }
        calendarState.syncTimer = window.setTimeout(() => {
            calendarState.syncTimer = null;
            syncCalendarData().catch((error) => console.error(error));
        }, VIEW_TRANSITION_MS);
    });
}

function bootCalendar() {
    if (!dom.root) return;
    const todayKey = formatDateKey(new Date());
    calendarState.selectedDate = todayKey;
    if (dom.jumpDate) {
        dom.jumpDate.value = todayKey;
    }
    renderGridHead();
    renderCalendarGrid();
    wireJumpActions();
    wireMonthActions();
    wireGridActions();
    wireModalActions();
    wireViewSync();
}

document.addEventListener("DOMContentLoaded", bootCalendar);
