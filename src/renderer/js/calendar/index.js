import { escapeHtml } from "../shared/dom.js";

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
const VIEW_TRANSITION_MS = 180;
const CALENDAR_SYNC_THROTTLE_MS = 3000;
const CALENDAR_LOCAL_CACHE_KEY = "live2dassistant.calendar.cache.v1";

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
    editingTodoId: "",
    editingTodoDraft: "",
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

function normalizePlanData(data = {}) {
    return {
        todos: Array.isArray(data?.todos) ? data.todos : [],
        aiDiaries: Array.isArray(data?.aiDiaries) ? data.aiDiaries : [],
        holidays: Array.isArray(data?.holidays) ? data.holidays : [],
    };
}

function readCachedCalendarData() {
    try {
        const storage = window.localStorage;
        if (!storage) return null;
        const raw = storage.getItem(CALENDAR_LOCAL_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        const savedAt = Number(parsed.savedAt || 0);
        return {
            data: normalizePlanData(parsed.data || {}),
            savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : 0,
        };
    } catch (error) {
        return null;
    }
}

function writeCachedCalendarData(data) {
    try {
        const storage = window.localStorage;
        if (!storage) return;
        storage.setItem(CALENDAR_LOCAL_CACHE_KEY, JSON.stringify({
            savedAt: Date.now(),
            data: normalizePlanData(data),
        }));
    } catch (error) {
        // Ignore cache write failure.
    }
}

function applyCalendarData(data, options = {}) {
    calendarState.data = normalizePlanData(data);
    calendarState.loaded = true;
    calendarState.lastSyncedAt = Number(options?.syncedAt || Date.now());
    renderCalendarGrid();
}

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
        badges.push({type: "todo", text: `待办 ${detail.todos.length}`});
    }
    if (detail.aiDiaries.length) {
        badges.push({type: "diary", text: "AI日记"});
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
                </div>
                <div class="calendar-cell__badges">
                    ${badges.slice(0, 2).map((badge) => `<span class="calendar-badge calendar-badge--${badge.type}">${escapeHtml(badge.text)}</span>`).join("")}
                </div>
            </article>
        `;
    }).join("");
    dom.grid.classList.toggle("is-switching", monthChanged);
}

function updateSelectedCell(dateKey) {
    if (!dom.grid) return;
    const cells = dom.grid.querySelectorAll('[data-role="calendar-cell"]');
    cells.forEach((cell) => {
        cell.classList.toggle("is-selected", (cell.dataset.date || "") === dateKey);
    });
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
    const diaryBadge = detail.aiDiaries.length
        ? [`<span class="calendar-badge calendar-badge--diary">AI日记</span>`]
        : [];
    dom.modalBadges.innerHTML = [
        `<span class="calendar-badge calendar-badge--todo">待办 ${detail.todos.length}</span>`,
        `<span class="calendar-badge calendar-badge--holiday">节假日 ${detail.holidays.length}</span>`,
        ...diaryBadge,
        ...holidayNameBadges,
    ].join("");
}

function renderTodoList(detail) {
    if (!dom.todoList) return;
    dom.todoList.innerHTML = `
        <form class="calendar-todoComposer" data-role="calendar-todo-composer">
            <input
                type="text"
                class="calendar-todoComposer__input"
                data-role="calendar-todo-draft"
                placeholder="输入待办标题（回车新增）"
                autocomplete="off"
                spellcheck="false"
            />
            <button type="submit" class="calendar-btn calendar-btn--small">新增</button>
        </form>
        <section class="calendar-todoList" aria-label="待办事项列表">
            ${detail.todos.length ? detail.todos.map((item) => `
                <article class="calendar-todoItem" data-status="${escapeHtml(item.status || "todo")}">
                    <div class="calendar-todoItem__checkWrap">
                        <input
                            type="checkbox"
                            class="calendar-todoItem__check"
                            data-action="toggle-todo"
                            data-id="${escapeHtml(item.id)}"
                            ${item.status === "done" ? "checked" : ""}
                            aria-label="${item.status === "done" ? "取消完成" : "标记完成"}"
                        />
                    </div>
                    ${calendarState.editingTodoId === item.id ? `
                        <input
                            type="text"
                            class="calendar-todoItem__editInput"
                            data-role="calendar-todo-inline-input"
                            data-id="${escapeHtml(item.id)}"
                            value="${escapeHtml(calendarState.editingTodoDraft || item.title || "")}"
                            autocomplete="off"
                            spellcheck="false"
                        />
                        <button type="button" class="calendar-record__btn calendar-todoItem__btn" data-action="save-todo-edit" data-id="${escapeHtml(item.id)}">保存</button>
                        <button type="button" class="calendar-record__btn calendar-todoItem__btn" data-action="cancel-todo-edit" data-id="${escapeHtml(item.id)}">取消</button>
                    ` : `
                        <p class="calendar-todoItem__title">${escapeHtml(item.title || "")}</p>
                        <button type="button" class="calendar-record__btn calendar-todoItem__btn" data-action="edit-todo" data-id="${escapeHtml(item.id)}">编辑</button>
                        <button type="button" class="calendar-record__btn calendar-todoItem__btn" data-action="delete-todo" data-id="${escapeHtml(item.id)}">删除</button>
                    `}
                </article>
            `).join("") : `
                <article class="calendar-todoItem calendar-todoItem--empty">
                    <p class="calendar-todoItem__emptyText">暂无待办，点击上方“新增待办”</p>
                </article>
            `}
        </section>
    `;
}

function resetTodoEditingState() {
    calendarState.editingTodoId = "";
    calendarState.editingTodoDraft = "";
}

function renderTodoListForSelectedDate() {
    if (!calendarState.selectedDate) return;
    const detail = getDateDetailFromState(calendarState.selectedDate, buildCalendarIndexes());
    renderTodoList(detail);
}

function focusTodoInlineInput(id) {
    if (!dom.todoList || !id) return;
    window.requestAnimationFrame(() => {
        const inputs = dom.todoList.querySelectorAll('[data-role="calendar-todo-inline-input"]');
        const input = [...inputs].find((item) => (item.dataset.id || "") === id);
        if (!input) return;
        input.focus();
        input.select();
    });
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
    if (!calendarState.loaded && window.api?.loadCalendarPlan) {
        await syncCalendarData();
    }
    calendarState.selectedDate = dateKey;
    updateSelectedCell(dateKey);
    if (dom.jumpDate) {
        dom.jumpDate.value = dateKey;
    }

    const detail = getDateDetailFromState(dateKey, buildCalendarIndexes());

    const date = parseDateKey(dateKey);
    dom.modalTitle.textContent = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    dom.modalMeta.textContent = `待办 ${detail.todos.length} 条 · AI日记：${detail.aiDiaries.length ? "有" : "无"} · 节假日 ${detail.holidays.length} 条`;
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
    const data = normalizePlanData(await window.api.loadCalendarPlan());
    applyCalendarData(data, {syncedAt: Date.now()});
    writeCachedCalendarData(data);
}

async function reloadAndRefreshModal() {
    await syncCalendarData();
    if (calendarState.editingTodoId && !findTodoById(calendarState.editingTodoId)) {
        resetTodoEditingState();
    }
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
    if (!todo && action !== "cancel-todo-edit") return;

    if (action === "toggle-todo") {
        await window.api.updateCalendarTodo({
            id: todo.id,
            status: todo.status === "done" ? "todo" : "done",
        });
        if (calendarState.editingTodoId === todo.id) {
            resetTodoEditingState();
        }
        await reloadAndRefreshModal();
        return;
    }
    if (action === "edit-todo") {
        calendarState.editingTodoId = todo.id;
        calendarState.editingTodoDraft = String(todo.title || "");
        renderTodoListForSelectedDate();
        focusTodoInlineInput(todo.id);
        return;
    }
    if (action === "save-todo-edit") {
        const title = String(calendarState.editingTodoDraft || "").trim();
        if (!title) {
            focusTodoInlineInput(id);
            return;
        }
        await window.api.updateCalendarTodo({
            id,
            title,
        });
        resetTodoEditingState();
        await reloadAndRefreshModal();
        return;
    }
    if (action === "cancel-todo-edit") {
        resetTodoEditingState();
        renderTodoListForSelectedDate();
        return;
    }
    if (action === "delete-todo") {
        const confirmed = window.confirm(`确认删除待办：${todo.title}？`);
        if (!confirmed) return;
        if (calendarState.editingTodoId === todo.id) {
            resetTodoEditingState();
        }
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

async function createTodoByTitle(rawTitle) {
    const title = String(rawTitle || "").trim();
    if (!title) return;
    const date = calendarState.selectedDate || formatDateKey(new Date());
    await window.api.createCalendarTodo({
        title,
        description: "",
        priority: "medium",
        date,
        status: "todo",
    });
    await reloadAndRefreshModal();
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
    updateSelectedCell(dateKey);
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
        if (event.detail >= 2) {
            jumpToDate(date, true);
            return;
        }
        selectDate(date);
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
    const closeTriggers = dom.modal?.querySelectorAll('[data-role="calendar-close"]') || [];
    closeTriggers.forEach((trigger) => {
        trigger.addEventListener("click", () => {
            closeModal();
        });
    });

    const modalDialog = dom.modal?.querySelector(".calendar-modal__dialog");
    modalDialog?.addEventListener("submit", (event) => {
        const form = event.target.closest('[data-role="calendar-todo-composer"]');
        if (!form) return;
        event.preventDefault();
        const input = form.querySelector('[data-role="calendar-todo-draft"]');
        const title = String(input?.value || "").trim();
        if (!title) {
            input?.focus();
            return;
        }
        createTodoByTitle(title)
            .then(() => {
                if (input) {
                    input.value = "";
                }
            })
            .catch((error) => console.error(error));
    });

    modalDialog?.addEventListener("click", (event) => {
        const actionEl = event.target.closest("[data-action]");
        if (!actionEl) return;
        const action = actionEl.dataset.action || "";
        const id = actionEl.dataset.id || "";
        if (!action) return;
        if (action.includes("todo") && !id) return;
        if (action.includes("todo")) {
            handleTodoAction(action, id).catch((error) => console.error(error));
            return;
        }
        if (action.includes("diary")) {
            handleDiaryAction(action, id).catch((error) => console.error(error));
        }
    });

    modalDialog?.addEventListener("input", (event) => {
        const inlineInput = event.target.closest('[data-role="calendar-todo-inline-input"]');
        if (!inlineInput) return;
        const id = inlineInput.dataset.id || "";
        if (!id || id !== calendarState.editingTodoId) return;
        calendarState.editingTodoDraft = String(inlineInput.value || "");
    });

    modalDialog?.addEventListener("keydown", (event) => {
        const inlineInput = event.target.closest('[data-role="calendar-todo-inline-input"]');
        if (!inlineInput) return;
        const id = inlineInput.dataset.id || "";
        if (!id) return;
        if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            handleTodoAction("save-todo-edit", id).catch((error) => console.error(error));
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            handleTodoAction("cancel-todo-edit", id).catch((error) => console.error(error));
        }
    });

    dom.addTodo?.addEventListener("click", async () => {
        const input = dom.todoList?.querySelector('[data-role="calendar-todo-draft"]');
        let title = String(input?.value || "").trim();
        if (!title) {
            const promptTitle = window.prompt("输入待办标题", "");
            title = String(promptTitle || "").trim();
            if (!title) {
                input?.focus();
                return;
            }
        }
        await createTodoByTitle(title);
        if (input) {
            input.value = "";
        }
    });

    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && dom.modal && !dom.modal.hidden) {
            closeModal();
        }
    });
}

function wireViewSync() {
    window.addEventListener("shell:viewchange", (event) => {
        if (event.detail?.viewKey !== "calendar") {
            if (dom.modal && !dom.modal.hidden) {
                closeModal();
            }
            return;
        }
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
    const cached = readCachedCalendarData();
    if (cached) {
        applyCalendarData(cached.data, {syncedAt: cached.savedAt || Date.now()});
    } else {
        renderCalendarGrid();
    }
    wireJumpActions();
    wireMonthActions();
    wireGridActions();
    wireModalActions();
    wireViewSync();
}

document.addEventListener("DOMContentLoaded", bootCalendar);
