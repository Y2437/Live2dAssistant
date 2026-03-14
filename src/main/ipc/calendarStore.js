const fs = require("fs/promises");

const CALENDAR_SCHEMA_VERSION = 1;
const TODO_STATUS_SET = new Set(["todo", "done"]);
const TODO_PRIORITY_SET = new Set(["low", "medium", "high"]);
const REMOTE_HOLIDAY_SOURCE = "online-timor";
const REMOTE_HOLIDAY_ENDPOINT = "https://timor.tech/api/holiday/year/";
const REMOTE_HOLIDAY_TIMEOUT_MS = 6500;
const REMOTE_HOLIDAY_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const remoteHolidayYearCache = new Map();
const remoteHolidayYearInflight = new Map();

const HOLIDAY_FIXED_RULES = [
    {startMonthDay: "01-01", endMonthDay: "01-03", name: "元旦", type: "public"},
    {monthDay: "02-14", name: "情人节", type: "festival"},
    {monthDay: "03-08", name: "妇女节", type: "festival"},
    {startMonthDay: "05-01", endMonthDay: "05-05", name: "劳动节", type: "public"},
    {monthDay: "06-01", name: "儿童节", type: "festival"},
    {monthDay: "09-10", name: "教师节", type: "festival"},
    {startMonthDay: "10-01", endMonthDay: "10-07", name: "国庆节", type: "public"},
    {monthDay: "12-24", name: "平安夜", type: "festival"},
    {monthDay: "12-25", name: "圣诞节", type: "festival"},
];

function createId(prefix = "id") {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeDateText(value, fieldName = "date") {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new Error(`${fieldName} must be in YYYY-MM-DD format.`);
    }
    return text;
}

function normalizeOptionalDateText(value, fieldName = "date") {
    if (value == null || value === "") {
        return "";
    }
    return normalizeDateText(value, fieldName);
}

function resolveHolidayRange(item = {}) {
    const date = normalizeOptionalDateText(item?.date, "Holiday date");
    const startDateRaw = normalizeOptionalDateText(item?.startDate, "Holiday startDate");
    const endDateRaw = normalizeOptionalDateText(item?.endDate, "Holiday endDate");

    const startDate = startDateRaw || date || endDateRaw;
    const endDate = endDateRaw || date || startDateRaw;

    if (!startDate || !endDate) {
        throw new Error("Holiday date or date range is required.");
    }
    if (endDate < startDate) {
        throw new Error("Holiday endDate must be greater than or equal to startDate.");
    }

    return {
        date: startDate,
        startDate,
        endDate,
    };
}

function isHolidayOnDate(item, targetDate) {
    const startDate = normalizeOptionalDateText(item?.startDate || item?.date, "Holiday startDate");
    const endDate = normalizeOptionalDateText(item?.endDate || item?.date, "Holiday endDate");
    if (!startDate || !endDate) {
        return false;
    }
    return targetDate >= startDate && targetDate <= endDate;
}

function normalizeTodoRecord(item) {
    const now = new Date().toISOString();
    const title = String(item?.title || "").trim();
    if (!title) {
        throw new Error("Todo title is required.");
    }
    const date = normalizeDateText(item?.date, "Todo date");
    const statusRaw = String(item?.status || "todo").trim().toLowerCase();
    const priorityRaw = String(item?.priority || "medium").trim().toLowerCase();
    return {
        id: String(item?.id || createId("todo")).trim(),
        title,
        description: String(item?.description || "").trim(),
        date,
        status: TODO_STATUS_SET.has(statusRaw) ? statusRaw : "todo",
        priority: TODO_PRIORITY_SET.has(priorityRaw) ? priorityRaw : "medium",
        createdAt: String(item?.createdAt || now),
        updatedAt: String(item?.updatedAt || now),
    };
}

function normalizeAiDiaryRecord(item) {
    const now = new Date().toISOString();
    const title = String(item?.title || "").trim() || "AI 日记";
    const content = String(item?.content || "").trim();
    if (!content) {
        throw new Error("AI diary content is required.");
    }
    const date = normalizeDateText(item?.date, "Diary date");
    return {
        id: String(item?.id || createId("diary")).trim(),
        date,
        title,
        content,
        mood: String(item?.mood || "").trim(),
        source: "ai",
        createdAt: String(item?.createdAt || now),
        updatedAt: String(item?.updatedAt || now),
    };
}

function normalizeHolidayRecord(item) {
    const {date, startDate, endDate} = resolveHolidayRange(item);
    const name = String(item?.name || "").trim();
    if (!name) {
        throw new Error("Holiday name is required.");
    }
    const type = String(item?.type || "public").trim() || "public";
    const defaultId = startDate === endDate
        ? `${startDate}-${name}`
        : `${startDate}_${endDate}-${name}`;
    return {
        id: String(item?.id || defaultId).trim(),
        date,
        startDate,
        endDate,
        name,
        type,
        source: String(item?.source || "builtin").trim() || "builtin",
    };
}

function normalizeWorkdayRecord(item) {
    const {date, startDate, endDate} = resolveHolidayRange(item);
    const name = String(item?.name || "").trim() || "调休";
    return {
        id: String(item?.id || `${startDate}_${endDate}-${name}`).trim(),
        date,
        startDate,
        endDate,
        name,
        type: String(item?.type || "workday").trim() || "workday",
        source: String(item?.source || "builtin").trim() || "builtin",
    };
}

function getSeedYears(aroundYear = new Date().getFullYear()) {
    return [aroundYear - 1, aroundYear, aroundYear + 1, aroundYear + 2];
}

function sortHolidayItems(items = []) {
    return [...items].sort((a, b) => {
        const startCompare = String(a.startDate || a.date).localeCompare(String(b.startDate || b.date), "zh-CN");
        if (startCompare !== 0) {
            return startCompare;
        }
        return String(a.endDate || a.date).localeCompare(String(b.endDate || b.date), "zh-CN");
    });
}

function seedBuiltinHolidays(existing = [], aroundYear = new Date().getFullYear()) {
    const years = getSeedYears(aroundYear);
    const merged = new Map();

    for (const item of existing) {
        try {
            const normalized = normalizeHolidayRecord(item);
            merged.set(normalized.id, normalized);
        } catch (error) {
            // Ignore broken item and keep loading.
        }
    }

    for (const year of years) {
        for (const rule of HOLIDAY_FIXED_RULES) {
            const startMonthDay = String(rule.startMonthDay || rule.monthDay || "").trim();
            const endMonthDay = String(rule.endMonthDay || rule.monthDay || "").trim();
            if (!startMonthDay || !endMonthDay) {
                continue;
            }
            const startDate = `${year}-${startMonthDay}`;
            const endDate = `${year}-${endMonthDay}`;
            const date = startDate;
            const id = startDate === endDate
                ? `${startDate}-${rule.name}`
                : `${startDate}_${endDate}-${rule.name}`;

            // Remove legacy single-day builtin records that overlap the first day of this multi-day builtin rule.
            if (startDate !== endDate) {
                for (const [legacyId, legacyItem] of merged.entries()) {
                    if (String(legacyItem?.source || "") !== "builtin") {
                        continue;
                    }
                    if (String(legacyItem?.name || "") !== String(rule.name || "")) {
                        continue;
                    }
                    if (String(legacyItem?.type || "") !== String(rule.type || "")) {
                        continue;
                    }
                    const legacyStart = String(legacyItem?.startDate || legacyItem?.date || "");
                    const legacyEnd = String(legacyItem?.endDate || legacyItem?.date || "");
                    if (legacyStart === startDate && legacyEnd === startDate) {
                        merged.delete(legacyId);
                    }
                }
            }

            if (!merged.has(id)) {
                merged.set(id, {
                    id,
                    date,
                    startDate,
                    endDate,
                    name: rule.name,
                    type: rule.type,
                    source: "builtin",
                });
            }
        }
    }

    return sortHolidayItems(merged.values());
}

function shiftDateText(dateText, offsetDays = 0) {
    const [year, month, day] = String(dateText || "").split("-").map((item) => Number(item));
    const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
    date.setUTCDate(date.getUTCDate() + Number(offsetDays || 0));
    const nextYear = date.getUTCFullYear();
    const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
    const nextDay = String(date.getUTCDate()).padStart(2, "0");
    return `${nextYear}-${nextMonth}-${nextDay}`;
}

async function requestRemoteHolidayYearPayload(year, timeoutMs = REMOTE_HOLIDAY_TIMEOUT_MS) {
    if (typeof fetch !== "function") {
        throw new Error("Global fetch is unavailable.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${REMOTE_HOLIDAY_ENDPOINT}${year}`, {
            method: "GET",
            headers: {Accept: "application/json"},
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Remote holiday API error: HTTP ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

function resolveRemoteDateText(monthDay, raw, year) {
    const keyText = String(monthDay || "").trim();
    const rawDate = String(raw?.date || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        return rawDate;
    }
    if (/^\d{2}-\d{2}$/.test(keyText)) {
        return `${year}-${keyText}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(keyText)) {
        return keyText;
    }
    return "";
}

function parseRemoteHolidayDays(payload, year) {
    const holidayMap = payload && typeof payload === "object" ? payload.holiday : null;
    if (!holidayMap || typeof holidayMap !== "object") {
        return [];
    }
    const items = [];
    for (const [monthDay, raw] of Object.entries(holidayMap)) {
        if (!raw || raw.holiday !== true) {
            continue;
        }
        const date = resolveRemoteDateText(monthDay, raw, year);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            continue;
        }
        const target = String(raw?.target || "").trim();
        const name = target || String(raw?.name || "").trim() || "节假日";
        items.push({
            date,
            name,
            target,
        });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date, "zh-CN"));
}

function isRemoteWorkdayEntry(raw = {}) {
    if (!raw || raw.holiday !== false) {
        return false;
    }
    const name = String(raw?.name || "").trim();
    const target = String(raw?.target || "").trim();
    return Boolean(target || /补班|调休/.test(name) || typeof raw?.after === "boolean");
}

function parseRemoteWorkdayDays(payload, year) {
    const holidayMap = payload && typeof payload === "object" ? payload.holiday : null;
    if (!holidayMap || typeof holidayMap !== "object") {
        return [];
    }
    const items = [];
    for (const [monthDay, raw] of Object.entries(holidayMap)) {
        if (!isRemoteWorkdayEntry(raw)) {
            continue;
        }
        const date = resolveRemoteDateText(monthDay, raw, year);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            continue;
        }
        const target = String(raw?.target || "").trim();
        const name = target || String(raw?.name || "").trim() || "调休";
        items.push({
            date,
            name,
            target,
        });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date, "zh-CN"));
}

function buildRemoteRanges(days = [], {kind = "holiday", defaultName = "节假日", type = "public"} = {}) {
    if (!days.length) {
        return [];
    }
    const ranges = [];
    let groupStart = days[0].date;
    let groupEnd = days[0].date;
    let groupNames = [days[0].name];
    let groupTargets = [days[0].target];

    function flushGroup() {
        const label = groupTargets.find((item) => item) || groupNames[0] || defaultName;
        const payload = {
            id: `${REMOTE_HOLIDAY_SOURCE}-${kind}-${groupStart}_${groupEnd}-${label}`,
            date: groupStart,
            startDate: groupStart,
            endDate: groupEnd,
            name: label,
            type,
            source: REMOTE_HOLIDAY_SOURCE,
        };
        const range = kind === "workday"
            ? normalizeWorkdayRecord(payload)
            : normalizeHolidayRecord(payload);
        ranges.push(range);
    }

    for (let index = 1; index < days.length; index += 1) {
        const day = days[index];
        const expectedNextDate = shiftDateText(groupEnd, 1);
        if (day.date === expectedNextDate) {
            groupEnd = day.date;
            groupNames.push(day.name);
            groupTargets.push(day.target);
            continue;
        }
        flushGroup();
        groupStart = day.date;
        groupEnd = day.date;
        groupNames = [day.name];
        groupTargets = [day.target];
    }
    flushGroup();
    return ranges;
}

async function fetchRemoteHolidayRangesByYear(year) {
    const normalizedYear = Number(year);
    if (!Number.isInteger(normalizedYear) || normalizedYear < 1970 || normalizedYear > 2100) {
        return {holidays: [], workdays: []};
    }
    const now = Date.now();
    const cached = remoteHolidayYearCache.get(normalizedYear);
    if (cached && cached.expiresAt > now) {
        return {
            holidays: Array.isArray(cached.holidays) ? cached.holidays : [],
            workdays: Array.isArray(cached.workdays) ? cached.workdays : [],
        };
    }
    const inflight = remoteHolidayYearInflight.get(normalizedYear);
    if (inflight) {
        return await inflight;
    }
    const task = (async () => {
        const payload = await requestRemoteHolidayYearPayload(normalizedYear);
        if (Number(payload?.code) !== 0) {
            throw new Error(`Remote holiday API returned code=${payload?.code}`);
        }
        const holidayDays = parseRemoteHolidayDays(payload, normalizedYear);
        const workdayDays = parseRemoteWorkdayDays(payload, normalizedYear);
        const holidayRanges = buildRemoteRanges(holidayDays, {
            kind: "holiday",
            defaultName: "节假日",
            type: "public",
        });
        const workdayRanges = buildRemoteRanges(workdayDays, {
            kind: "workday",
            defaultName: "调休",
            type: "workday",
        });
        remoteHolidayYearCache.set(normalizedYear, {
            holidays: holidayRanges,
            workdays: workdayRanges,
            expiresAt: Date.now() + REMOTE_HOLIDAY_CACHE_TTL_MS,
        });
        return {
            holidays: holidayRanges,
            workdays: workdayRanges,
        };
    })();
    remoteHolidayYearInflight.set(normalizedYear, task);
    try {
        return await task;
    } finally {
        remoteHolidayYearInflight.delete(normalizedYear);
    }
}

async function loadRemoteHolidayRanges(years = []) {
    const uniqueYears = [...new Set(years.map((item) => Number(item)).filter((year) => Number.isInteger(year)))];
    const settled = await Promise.all(uniqueYears.map(async (year) => {
        try {
            const remote = await fetchRemoteHolidayRangesByYear(year);
            const hasAny = (remote.holidays?.length || 0) > 0 || (remote.workdays?.length || 0) > 0;
            return {
                year,
                ok: hasAny,
                holidays: remote.holidays || [],
                workdays: remote.workdays || [],
            };
        } catch (error) {
            return {
                year,
                ok: false,
                holidays: [],
                workdays: [],
            };
        }
    }));
    return {
        successYears: settled.filter((item) => item.ok).map((item) => item.year),
        holidays: settled.filter((item) => item.ok).flatMap((item) => item.holidays),
        workdays: settled.filter((item) => item.ok).flatMap((item) => item.workdays),
    };
}

function mergeRemoteDateRangeItems(localItems = [], remoteItems = [], successYears = []) {
    if (!remoteItems.length || !successYears.length) {
        return sortHolidayItems(localItems);
    }
    const successYearSet = new Set(successYears.map((item) => Number(item)));
    const merged = new Map();

    for (const item of localItems) {
        const startDate = String(item?.startDate || item?.date || "");
        const year = Number(startDate.slice(0, 4));
        const source = String(item?.source || "");
        const shouldOverrideByRemote = successYearSet.has(year)
            && (source === "builtin" || source === REMOTE_HOLIDAY_SOURCE);
        if (!shouldOverrideByRemote) {
            merged.set(String(item?.id || createId("holiday")), item);
        }
    }

    for (const item of remoteItems) {
        merged.set(String(item?.id || createId("holiday")), item);
    }
    return sortHolidayItems(merged.values());
}

async function withRemoteHolidayFallback(data = {}) {
    const baseHolidays = Array.isArray(data?.holidays) ? data.holidays : [];
    const baseWorkdays = Array.isArray(data?.workdays) ? data.workdays : [];
    const years = getSeedYears(new Date().getFullYear());
    try {
        const remote = await loadRemoteHolidayRanges(years);
        if (!remote.successYears.length || (!remote.holidays.length && !remote.workdays.length)) {
            return data;
        }
        return {
            ...data,
            holidays: mergeRemoteDateRangeItems(baseHolidays, remote.holidays, remote.successYears),
            workdays: mergeRemoteDateRangeItems(baseWorkdays, remote.workdays, remote.successYears),
        };
    } catch (error) {
        return data;
    }
}

function normalizeCalendarData(data = {}) {
    const todos = Array.isArray(data?.todos) ? data.todos : [];
    const aiDiaries = Array.isArray(data?.aiDiaries) ? data.aiDiaries : [];
    const holidays = Array.isArray(data?.holidays) ? data.holidays : [];
    const workdays = Array.isArray(data?.workdays) ? data.workdays : [];

    const normalizedTodos = todos
        .map((item) => {
            try {
                return normalizeTodoRecord(item);
            } catch (error) {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => String(a.date).localeCompare(String(b.date), "zh-CN") || String(a.updatedAt).localeCompare(String(b.updatedAt), "zh-CN"));

    const normalizedDiaries = aiDiaries
        .map((item) => {
            try {
                return normalizeAiDiaryRecord(item);
            } catch (error) {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => String(a.date).localeCompare(String(b.date), "zh-CN") || String(b.updatedAt).localeCompare(String(a.updatedAt), "zh-CN"));

    const normalizedWorkdays = workdays
        .map((item) => {
            try {
                return normalizeWorkdayRecord(item);
            } catch (error) {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => String(a.startDate || a.date).localeCompare(String(b.startDate || b.date), "zh-CN") || String(a.endDate || a.date).localeCompare(String(b.endDate || b.date), "zh-CN"));

    return {
        version: CALENDAR_SCHEMA_VERSION,
        todos: normalizedTodos,
        aiDiaries: normalizedDiaries,
        holidays: seedBuiltinHolidays(holidays),
        workdays: normalizedWorkdays,
        updatedAt: new Date().toISOString(),
    };
}

async function readCalendarData(dataPath, options = {}) {
    const useRemote = options?.useRemote !== false;
    try {
        const raw = await fs.readFile(dataPath, "utf8");
        const normalized = normalizeCalendarData(JSON.parse(raw));
        return useRemote ? await withRemoteHolidayFallback(normalized) : normalized;
    } catch (error) {
        if (error?.code === "ENOENT") {
            const initial = normalizeCalendarData({});
            await fs.writeFile(dataPath, JSON.stringify(initial, null, 2), "utf-8");
            return useRemote ? await withRemoteHolidayFallback(initial) : initial;
        }
        throw error;
    }
}

async function writeCalendarData(dataPath, data) {
    const normalized = normalizeCalendarData(data);
    await fs.writeFile(dataPath, JSON.stringify(normalized, null, 2), "utf-8");
    return normalized;
}

async function ensureCalendarPlanJson(dataPath) {
    const data = await readCalendarData(dataPath, {useRemote: false});
    await writeCalendarData(dataPath, data);
    return data;
}

function filterByDateRange(items = [], {date = "", startDate = "", endDate = ""} = {}) {
    const exactDate = normalizeOptionalDateText(date, "date");
    const from = normalizeOptionalDateText(startDate, "startDate");
    const to = normalizeOptionalDateText(endDate, "endDate");

    return items.filter((item) => {
        const itemDate = String(item?.date || "");
        if (exactDate && itemDate !== exactDate) {
            return false;
        }
        if (from && itemDate < from) {
            return false;
        }
        if (to && itemDate > to) {
            return false;
        }
        return true;
    });
}

async function listCalendarTodos(dataPath, filters = {}) {
    const data = await readCalendarData(dataPath, {useRemote: false});
    let items = filterByDateRange(data.todos, filters);
    const status = String(filters?.status || "").trim().toLowerCase();
    if (status && TODO_STATUS_SET.has(status)) {
        items = items.filter((item) => item.status === status);
    }
    return {
        count: items.length,
        items,
    };
}

async function createCalendarTodoRecord(dataPath, payload = {}) {
    const data = await readCalendarData(dataPath, {useRemote: false});
    const now = new Date().toISOString();
    const record = normalizeTodoRecord({
        ...payload,
        id: payload?.id || createId("todo"),
        createdAt: now,
        updatedAt: now,
    });
    data.todos.push(record);
    const saved = await writeCalendarData(dataPath, data);
    return {
        item: saved.todos.find((item) => item.id === record.id) || record,
        data: saved,
    };
}

async function updateCalendarTodoRecord(dataPath, payload = {}) {
    const id = String(payload?.id || "").trim();
    if (!id) {
        throw new Error("Todo id is required.");
    }
    const data = await readCalendarData(dataPath, {useRemote: false});
    const index = data.todos.findIndex((item) => item.id === id);
    if (index < 0) {
        throw new Error("Todo not found.");
    }
    const previous = data.todos[index];
    const record = normalizeTodoRecord({
        ...previous,
        ...payload,
        id,
        createdAt: previous.createdAt,
        updatedAt: new Date().toISOString(),
    });
    data.todos[index] = record;
    const saved = await writeCalendarData(dataPath, data);
    return {
        item: saved.todos.find((item) => item.id === id) || record,
        data: saved,
    };
}

async function deleteCalendarTodoRecord(dataPath, id) {
    const todoId = String(id || "").trim();
    if (!todoId) {
        throw new Error("Todo id is required.");
    }
    const data = await readCalendarData(dataPath, {useRemote: false});
    const nextItems = data.todos.filter((item) => item.id !== todoId);
    if (nextItems.length === data.todos.length) {
        throw new Error("Todo not found.");
    }
    data.todos = nextItems;
    return await writeCalendarData(dataPath, data);
}

async function listAiDiaries(dataPath, filters = {}) {
    const data = await readCalendarData(dataPath, {useRemote: false});
    const query = String(filters?.query || "").trim().toLowerCase();
    let items = filterByDateRange(data.aiDiaries, filters);
    if (query) {
        items = items.filter((item) => `${item.title}\n${item.content}\n${item.mood}`.toLowerCase().includes(query));
    }
    return {
        count: items.length,
        items,
    };
}

async function createAiDiaryRecord(dataPath, payload = {}) {
    const data = await readCalendarData(dataPath, {useRemote: false});
    const now = new Date().toISOString();
    const record = normalizeAiDiaryRecord({
        ...payload,
        id: payload?.id || createId("diary"),
        createdAt: now,
        updatedAt: now,
        source: "ai",
    });
    data.aiDiaries.push(record);
    const saved = await writeCalendarData(dataPath, data);
    return {
        item: saved.aiDiaries.find((item) => item.id === record.id) || record,
        data: saved,
    };
}

async function updateAiDiaryRecord(dataPath, payload = {}) {
    const id = String(payload?.id || "").trim();
    if (!id) {
        throw new Error("Diary id is required.");
    }
    const data = await readCalendarData(dataPath, {useRemote: false});
    const index = data.aiDiaries.findIndex((item) => item.id === id);
    if (index < 0) {
        throw new Error("Diary not found.");
    }
    const previous = data.aiDiaries[index];
    const record = normalizeAiDiaryRecord({
        ...previous,
        ...payload,
        id,
        createdAt: previous.createdAt,
        updatedAt: new Date().toISOString(),
        source: "ai",
    });
    data.aiDiaries[index] = record;
    const saved = await writeCalendarData(dataPath, data);
    return {
        item: saved.aiDiaries.find((item) => item.id === id) || record,
        data: saved,
    };
}

async function deleteAiDiaryRecord(dataPath, id) {
    const diaryId = String(id || "").trim();
    if (!diaryId) {
        throw new Error("Diary id is required.");
    }
    const data = await readCalendarData(dataPath, {useRemote: false});
    const nextItems = data.aiDiaries.filter((item) => item.id !== diaryId);
    if (nextItems.length === data.aiDiaries.length) {
        throw new Error("Diary not found.");
    }
    data.aiDiaries = nextItems;
    return await writeCalendarData(dataPath, data);
}

async function getCalendarDayDetail(dataPath, date) {
    const targetDate = normalizeDateText(date, "date");
    const data = await readCalendarData(dataPath);
    return {
        date: targetDate,
        todos: data.todos.filter((item) => item.date === targetDate),
        aiDiaries: data.aiDiaries.filter((item) => item.date === targetDate),
        holidays: data.holidays.filter((item) => isHolidayOnDate(item, targetDate)),
        workdays: (Array.isArray(data.workdays) ? data.workdays : []).filter((item) => isHolidayOnDate(item, targetDate)),
    };
}

module.exports = {
    ensureCalendarPlanJson,
    readCalendarData,
    writeCalendarData,
    listCalendarTodos,
    createCalendarTodoRecord,
    updateCalendarTodoRecord,
    deleteCalendarTodoRecord,
    listAiDiaries,
    createAiDiaryRecord,
    updateAiDiaryRecord,
    deleteAiDiaryRecord,
    getCalendarDayDetail,
};
