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
        workdays: [],
    },
    loaded: false,
    lastSyncedAt: 0,
    syncTimer: null,
    lastMonthKey: "",
    editingTodoId: "",
    editingTodoDraft: "",
    editingDiaryId: "",
    editingDiaryTitleDraft: "",
    editingDiaryContentDraft: "",
    isSyncing: false,
    usingCache: false,
    syncError: "",
    lastFocusedElement: null,
};

const dom = {
    root: document.querySelector(".calendar-root"),
    title: document.querySelector('[data-role="calendar-title"]'),
    status: document.querySelector('[data-role="calendar-status"]'),
    prevMonth: document.querySelector('[data-role="calendar-prev-month"]'),
    nextMonth: document.querySelector('[data-role="calendar-next-month"]'),
    jumpDate: document.querySelector('[data-role="calendar-jump-date"]'),
    jumpToday: document.querySelector('[data-role="calendar-jump-today"]'),
    jumpDateBtn: document.querySelector('[data-role="calendar-jump-date-btn"]'),
    gridHead: document.querySelector('[data-role="calendar-grid-head"]'),
    grid: document.querySelector('[data-role="calendar-grid"]'),
    modal: document.querySelector('[data-role="calendar-modal"]'),
    modalDialog: document.querySelector('[data-role="calendar-modal-dialog"]'),
    modalTitle: document.querySelector('[data-role="calendar-modal-title"]'),
    modalMeta: document.querySelector('[data-role="calendar-modal-meta"]'),
    modalBadges: document.querySelector('[data-role="calendar-modal-badges"]'),
    modalStatus: document.querySelector('[data-role="calendar-modal-status"]'),
    todoList: document.querySelector('[data-role="calendar-todo-list"]'),
    diaryList: document.querySelector('[data-role="calendar-diary-list"]'),
    addTodo: document.querySelector('[data-role="calendar-add-todo"]'),
};

function normalizePlanData(data = {}) {
    return {
        todos: Array.isArray(data?.todos) ? data.todos : [],
        aiDiaries: Array.isArray(data?.aiDiaries) ? data.aiDiaries : [],
        holidays: Array.isArray(data?.holidays) ? data.holidays : [],
        workdays: Array.isArray(data?.workdays) ? data.workdays : [],
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
    calendarState.usingCache = options?.usingCache === true;
    renderCalendarGrid();
}

function setCalendarStatus(message, type = "info") {
    if (!dom.status) return;
    dom.status.textContent = message || "";
    dom.status.dataset.state = type;
}

function setModalStatus(message, type = "info") {
    if (!dom.modalStatus) return;
    dom.modalStatus.textContent = message || "";
    dom.modalStatus.dataset.state = type;
}

function clearModalStatus() {
    setModalStatus("", "info");
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

function ensureRangeDayState(index, dateKey) {
    if (!index.has(dateKey)) {
        index.set(dateKey, {
            items: [],
            itemIds: new Set(),
            badgeNames: new Set(),
            hasBackground: false,
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

function buildRangeDateIndex(items = [], {badgeTypes = new Set(["public", "festival", "workday"]), paintBackgroundTypes = new Set(["public"])} = {}) {
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
        const itemId = String(item?.id || `${range.startDate}_${range.endDate}-${range.name}`).trim();
        while (cursor <= range.endDate) {
            const dayState = ensureRangeDayState(dateIndex, cursor);
            if (!dayState.itemIds.has(itemId)) {
                dayState.itemIds.add(itemId);
                dayState.items.push(item);
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
                    type: range.type,
                });
                continue;
            }
            const contiguousDate = shiftDateKey(last.endDate, 1);
            if (range.startDate <= contiguousDate && range.type === last.type) {
                if (range.endDate > last.endDate) {
                    last.endDate = range.endDate;
                }
                continue;
            }
            mergedRanges.push({
                startDate: range.startDate,
                endDate: range.endDate,
                name: range.name,
                type: range.type,
            });
        }

        for (const range of mergedRanges) {
            let cursor = range.startDate;
            let isFirstDay = true;
            while (cursor <= range.endDate) {
                const dayState = ensureRangeDayState(dateIndex, cursor);
                if (paintBackgroundTypes.has(range.type)) {
                    dayState.hasBackground = true;
                }
                if (isFirstDay && badgeTypes.has(range.type)) {
                    dayState.badgeNames.add(range.name || (range.type === "workday" ? "调休工作日" : "节日"));
                    isFirstDay = false;
                }
                cursor = shiftDateKey(cursor, 1);
            }
        }
    }

    for (const dayState of dateIndex.values()) {
        delete dayState.itemIds;
    }
    return dateIndex;
}

function buildCalendarIndexes() {
    return {
        todoIndex: buildDateIndex(calendarState.data.todos),
        diaryIndex: buildDateIndex(calendarState.data.aiDiaries),
        holidayIndex: buildRangeDateIndex(calendarState.data.holidays, {
            badgeTypes: new Set(["public", "festival"]),
            paintBackgroundTypes: new Set(["public", "festival"]),
        }),
        workdayIndex: buildRangeDateIndex(calendarState.data.workdays, {
            badgeTypes: new Set(["workday"]),
            paintBackgroundTypes: new Set(),
        }),
    };
}

function getDateDetailFromState(dateKey, indexes = buildCalendarIndexes()) {
    const holidayState = indexes.holidayIndex.get(dateKey);
    const workdayState = indexes.workdayIndex.get(dateKey);
    const holidays = holidayState?.items || [];
    const workdays = workdayState?.items || [];
    return {
        date: dateKey,
        todos: indexes.todoIndex.get(dateKey) || [],
        aiDiaries: indexes.diaryIndex.get(dateKey) || [],
        holidays,
        workdays,
        isHoliday: holidays.length > 0,
        isWorkday: workdays.length > 0,
    };
}

function getHolidayFlagsForDate(dateKey, indexes = buildCalendarIndexes()) {
    const holidayState = indexes.holidayIndex.get(dateKey);
    const workdayState = indexes.workdayIndex.get(dateKey);
    return {
        hasHolidayBackground: Boolean(holidayState?.hasBackground),
        holidayBadgeNames: holidayState ? [...holidayState.badgeNames] : [],
        workdayBadgeNames: workdayState ? [...workdayState.badgeNames] : [],
        isWorkday: Boolean(workdayState?.items?.length),
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
    for (const workdayName of holidayFlags.workdayBadgeNames) {
        badges.push({type: "workday", text: workdayName || "调休工作日"});
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
        const isAdjustedWorkday = holidayFlags.isWorkday;
        const day = date.getDay();
        const isWeekend = day === 0 || day === 6;
        const selected = calendarState.selectedDate === key;
        const isToday = key === todayKey;
        return `
            <article
                class="calendar-cell${inCurrentMonth ? "" : " is-outside"}${hasHoliday ? " is-holiday" : ""}${isAdjustedWorkday ? " is-workday" : ""}${isWeekend && !hasHoliday && !isAdjustedWorkday ? " is-weekend" : ""}${selected ? " is-selected" : ""}${isToday ? " is-today" : ""}"
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

function renderBlankCard(message = "暂无内容") {
    return `
        <article class="calendar-record calendar-record--empty">
            <p class="calendar-record__body calendar-record__body--muted">${escapeHtml(message)}</p>
        </article>
    `;
}

function renderModalBadges(detail) {
    if (!dom.modalBadges) return;
    const holidayNames = [...new Set(detail.holidays.map((item) => String(item?.name || "").trim()).filter(Boolean))].slice(0, 4);
    const workdayNames = [...new Set(detail.workdays.map((item) => String(item?.name || "").trim()).filter(Boolean))].slice(0, 2);
    const diaryBadge = detail.aiDiaries.length
        ? [`<span class="calendar-badge calendar-badge--diary">AI日记</span>`]
        : [];
    dom.modalBadges.innerHTML = [
        `<span class="calendar-badge calendar-badge--todo">待办 ${detail.todos.length}</span>`,
        `<span class="calendar-badge calendar-badge--holiday">节假日 ${holidayNames.length}</span>`,
        ...diaryBadge,
        ...holidayNames.map((name) => `<span class="calendar-badge calendar-badge--holiday">${escapeHtml(name)}</span>`),
        ...workdayNames.map((name) => `<span class="calendar-badge calendar-badge--workday">${escapeHtml(name || "调休工作日")}</span>`),
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

function resetDiaryEditingState() {
    calendarState.editingDiaryId = "";
    calendarState.editingDiaryTitleDraft = "";
    calendarState.editingDiaryContentDraft = "";
}

function normalizeDayDetail(detail = {}) {
    return {
        date: String(detail?.date || calendarState.selectedDate || ""),
        todos: Array.isArray(detail?.todos) ? detail.todos : [],
        aiDiaries: Array.isArray(detail?.aiDiaries) ? detail.aiDiaries : [],
        holidays: Array.isArray(detail?.holidays) ? detail.holidays : [],
        workdays: Array.isArray(detail?.workdays) ? detail.workdays : [],
        isHoliday: detail?.isHoliday === true,
        isWorkday: detail?.isWorkday === true,
    };
}

async function loadDayDetail(dateKey) {
    if (window.api?.getCalendarDayDetail) {
        try {
            return normalizeDayDetail(await window.api.getCalendarDayDetail(dateKey));
        } catch (error) {
            setModalStatus(`详情读取失败，已使用本地缓存：${error?.message || error}`, "warning");
        }
    }
    return normalizeDayDetail(getDateDetailFromState(dateKey, buildCalendarIndexes()));
}

function renderTodoListForSelectedDate() {
    if (!calendarState.selectedDate) return;
    const detail = getDateDetailFromState(calendarState.selectedDate, buildCalendarIndexes());
    renderTodoList(normalizeDayDetail(detail));
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
        dom.diaryList.innerHTML = renderBlankCard("当天暂无 AI 日记");
        return;
    }
    dom.diaryList.innerHTML = detail.aiDiaries.map((item) => {
        const isEditing = calendarState.editingDiaryId === item.id;
        return `
        <article class="calendar-record">
            <div class="calendar-record__head">
                <h6 class="calendar-record__title">${escapeHtml(item.title || "AI 日记")}</h6>
                <span class="calendar-badge calendar-badge--diary">${escapeHtml(item.mood || "记录")}</span>
            </div>
            <p class="calendar-record__meta">更新时间：${escapeHtml(item.updatedAt || item.createdAt || "")}</p>
            ${isEditing ? `
                <label class="cards-field">
                    <span class="calendar-jump__label">标题</span>
                    <input type="text" class="calendar-todoItem__editInput" data-role="calendar-diary-title-input" data-id="${escapeHtml(item.id)}" value="${escapeHtml(calendarState.editingDiaryTitleDraft || item.title || "AI 日记")}" />
                </label>
                <label class="cards-field">
                    <span class="calendar-jump__label">内容</span>
                    <textarea class="cards-field__control cards-field__control--textarea" data-role="calendar-diary-content-input" data-id="${escapeHtml(item.id)}" rows="6">${escapeHtml(calendarState.editingDiaryContentDraft || item.content || "")}</textarea>
                </label>
                <div class="calendar-record__actions">
                    <button type="button" class="calendar-record__btn" data-action="save-diary-edit" data-id="${escapeHtml(item.id)}">保存</button>
                    <button type="button" class="calendar-record__btn" data-action="cancel-diary-edit" data-id="${escapeHtml(item.id)}">取消</button>
                </div>
            ` : `
                <p class="calendar-record__body">${escapeHtml(item.content || "")}</p>
                <div class="calendar-record__actions">
                    <button type="button" class="calendar-record__btn" data-action="edit-diary" data-id="${escapeHtml(item.id)}">编辑</button>
                </div>
            `}
        </article>
    `;
    }).join("");
}

function renderModalForDetail(rawDetail) {
    const detail = normalizeDayDetail(rawDetail);
    const date = parseDateKey(detail.date);
    dom.modalTitle.textContent = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    dom.modalMeta.textContent = `待办 ${detail.todos.length} 条 · AI日记：${detail.aiDiaries.length ? "有" : "无"} · 节假日 ${detail.holidays.length} 条 · 调休工作日 ${detail.workdays.length} 条`;
    renderModalBadges(detail);
    renderTodoList(detail);
    renderDiaryList(detail);
}

async function openDateDetail(dateKey) {
    if (!dom.modal || !dom.modalTitle || !dom.modalMeta) return;
    if (!calendarState.loaded && window.api?.loadCalendarPlan) {
        await syncCalendarData();
    }
    calendarState.lastFocusedElement = document.activeElement;
    calendarState.selectedDate = dateKey;
    updateSelectedCell(dateKey);
    if (dom.jumpDate) {
        dom.jumpDate.value = dateKey;
    }
    clearModalStatus();
    const detail = await loadDayDetail(dateKey);
    renderModalForDetail(detail);
    dom.modal.hidden = false;
    window.requestAnimationFrame(() => {
        const closeButton = dom.modal?.querySelector('.calendar-modal__close');
        (closeButton || dom.modalDialog)?.focus();
    });
}

function closeModal() {
    if (dom.modal) {
        dom.modal.hidden = true;
    }
    resetTodoEditingState();
    resetDiaryEditingState();
    clearModalStatus();
    const previous = calendarState.lastFocusedElement;
    if (previous && typeof previous.focus === "function" && previous.isConnected) {
        previous.focus();
        return;
    }
    const selectedCell = dom.grid?.querySelector(`[data-date="${calendarState.selectedDate}"]`);
    selectedCell?.focus();
}

async function syncCalendarData() {
    if (!window.api?.loadCalendarPlan) {
        setCalendarStatus("当前环境不支持日历同步。", "warning");
        return;
    }
    if (calendarState.isSyncing) return;
    calendarState.isSyncing = true;
    calendarState.syncError = "";
    setCalendarStatus(calendarState.usingCache ? "正在用缓存显示，后台同步中…" : "正在同步日历数据…", "info");
    try {
        const data = normalizePlanData(await window.api.loadCalendarPlan());
        applyCalendarData(data, {syncedAt: Date.now(), usingCache: false});
        writeCachedCalendarData(data);
        setCalendarStatus("日历数据已同步。", "success");
    } catch (error) {
        calendarState.syncError = error?.message || String(error);
        setCalendarStatus(`日历同步失败，继续显示当前数据：${calendarState.syncError}`, "error");
        throw error;
    } finally {
        calendarState.isSyncing = false;
    }
}

async function reloadAndRefreshModal() {
    await syncCalendarData();
    if (calendarState.editingTodoId && !findTodoById(calendarState.editingTodoId)) {
        resetTodoEditingState();
    }
    if (calendarState.editingDiaryId && !findDiaryById(calendarState.editingDiaryId)) {
        resetDiaryEditingState();
    }
    if (calendarState.selectedDate && dom.modal && !dom.modal.hidden) {
        const detail = await loadDayDetail(calendarState.selectedDate);
        renderModalForDetail(detail);
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
        setModalStatus("待办状态已更新。", "success");
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
            setModalStatus("待办标题不能为空。", "error");
            focusTodoInlineInput(id);
            return;
        }
        await window.api.updateCalendarTodo({
            id,
            title,
        });
        setModalStatus("待办已保存。", "success");
        resetTodoEditingState();
        await reloadAndRefreshModal();
        return;
    }
    if (action === "cancel-todo-edit") {
        resetTodoEditingState();
        clearModalStatus();
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
        setModalStatus("待办已删除。", "success");
        await reloadAndRefreshModal();
    }
}

async function handleDiaryAction(action, id) {
    const diary = findDiaryById(id);
    if (!diary && action !== "cancel-diary-edit") return;

    if (action === "edit-diary") {
        calendarState.editingDiaryId = diary.id;
        calendarState.editingDiaryTitleDraft = String(diary.title || "AI 日记");
        calendarState.editingDiaryContentDraft = String(diary.content || "");
        renderDiaryList(normalizeDayDetail(getDateDetailFromState(calendarState.selectedDate, buildCalendarIndexes())));
        return;
    }
    if (action === "save-diary-edit") {
        const title = String(calendarState.editingDiaryTitleDraft || "AI 日记").trim() || "AI 日记";
        const content = String(calendarState.editingDiaryContentDraft || "").trim();
        if (!content) {
            setModalStatus("AI 日记内容不能为空。", "error");
            return;
        }
        await window.api.updateAiDiary({
            id,
            title,
            content,
            mood: diary?.mood || "",
        });
        setModalStatus("AI 日记已保存。", "success");
        resetDiaryEditingState();
        await reloadAndRefreshModal();
        return;
    }
    if (action === "cancel-diary-edit") {
        resetDiaryEditingState();
        clearModalStatus();
        renderDiaryList(normalizeDayDetail(getDateDetailFromState(calendarState.selectedDate, buildCalendarIndexes())));
    }
}

async function createTodoByTitle(rawTitle) {
    const title = String(rawTitle || "").trim();
    if (!title) {
        setModalStatus("请输入待办标题。", "error");
        return;
    }
    const date = calendarState.selectedDate || formatDateKey(new Date());
    await window.api.createCalendarTodo({
        title,
        description: "",
        priority: "medium",
        date,
        status: "todo",
    });
    setModalStatus("待办已创建。", "success");
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
        openDateDetail(dateKey).catch((error) => {
            setCalendarStatus(`打开日期详情失败：${error?.message || error}`, "error");
        });
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
        jumpToDate(date, true);
    });

    dom.grid?.addEventListener("keydown", (event) => {
        const cell = event.target.closest('[data-role="calendar-cell"]');
        if (!cell) return;
        if (event.key !== "Enter" && event.key !== " ") return;
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

    const modalDialog = dom.modalDialog;
    modalDialog?.addEventListener("submit", (event) => {
        const form = event.target.closest('[data-role="calendar-todo-composer"]');
        if (!form) return;
        event.preventDefault();
        const input = form.querySelector('[data-role="calendar-todo-draft"]');
        const title = String(input?.value || "").trim();
        if (!title) {
            setModalStatus("请输入待办标题。", "error");
            input?.focus();
            return;
        }
        createTodoByTitle(title)
            .then(() => {
                if (input) {
                    input.value = "";
                }
            })
            .catch((error) => setModalStatus(`新增待办失败：${error?.message || error}`, "error"));
    });

    modalDialog?.addEventListener("click", (event) => {
        const actionEl = event.target.closest("[data-action]");
        if (!actionEl) return;
        const action = actionEl.dataset.action || "";
        const id = actionEl.dataset.id || "";
        if (!action) return;
        if (action.includes("todo") && !id) return;
        if (action.includes("todo")) {
            handleTodoAction(action, id).catch((error) => setModalStatus(`待办操作失败：${error?.message || error}`, "error"));
            return;
        }
        if (action.includes("diary")) {
            handleDiaryAction(action, id).catch((error) => setModalStatus(`日记操作失败：${error?.message || error}`, "error"));
        }
    });

    modalDialog?.addEventListener("input", (event) => {
        const inlineInput = event.target.closest('[data-role="calendar-todo-inline-input"]');
        if (inlineInput) {
            const id = inlineInput.dataset.id || "";
            if (!id || id !== calendarState.editingTodoId) return;
            calendarState.editingTodoDraft = String(inlineInput.value || "");
            return;
        }
        const diaryTitleInput = event.target.closest('[data-role="calendar-diary-title-input"]');
        if (diaryTitleInput) {
            calendarState.editingDiaryTitleDraft = String(diaryTitleInput.value || "");
            return;
        }
        const diaryContentInput = event.target.closest('[data-role="calendar-diary-content-input"]');
        if (diaryContentInput) {
            calendarState.editingDiaryContentDraft = String(diaryContentInput.value || "");
        }
    });

    modalDialog?.addEventListener("keydown", (event) => {
        const inlineInput = event.target.closest('[data-role="calendar-todo-inline-input"]');
        if (inlineInput) {
            const id = inlineInput.dataset.id || "";
            if (!id) return;
            if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                handleTodoAction("save-todo-edit", id).catch((error) => setModalStatus(`待办保存失败：${error?.message || error}`, "error"));
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                handleTodoAction("cancel-todo-edit", id).catch((error) => setModalStatus(`取消编辑失败：${error?.message || error}`, "error"));
                return;
            }
        }

        if (event.key === "Tab" && dom.modal && !dom.modal.hidden) {
            const focusable = [...modalDialog.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
                .filter((item) => !item.disabled && item.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });

    dom.addTodo?.addEventListener("click", () => {
        const input = dom.todoList?.querySelector('[data-role="calendar-todo-draft"]');
        input?.focus();
        setModalStatus("请输入待办标题后提交。", "info");
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
        applyCalendarData(cached.data, {syncedAt: cached.savedAt || Date.now(), usingCache: true});
        setCalendarStatus("已加载本地缓存，进入日历视图后会自动同步。", "warning");
    } else {
        renderCalendarGrid();
        setCalendarStatus("正在准备日历数据…", "info");
    }
    wireJumpActions();
    wireMonthActions();
    wireGridActions();
    wireModalActions();
    wireViewSync();
}

document.addEventListener("DOMContentLoaded", bootCalendar);
