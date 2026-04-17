const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const calendarStore = require("../src/main/ipc/calendarStore");

async function createTempCalendarPath() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "live2d-calendar-"));
    return {
        dir,
        dataPath: path.join(dir, "calendar.json"),
        async cleanup() {
            await fs.rm(dir, {recursive: true, force: true});
        },
    };
}

test("ensureCalendarPlanJson creates normalized calendar file", async () => {
    const temp = await createTempCalendarPath();
    try {
        const data = await calendarStore.ensureCalendarPlanJson(temp.dataPath);
        assert.equal(data.version, 1);
        assert.ok(Array.isArray(data.todos));
        assert.ok(Array.isArray(data.aiDiaries));
        assert.ok(Array.isArray(data.holidays));
        assert.ok(data.holidays.length > 0);
        const raw = JSON.parse(await fs.readFile(temp.dataPath, "utf8"));
        assert.equal(raw.version, 1);
    } finally {
        await temp.cleanup();
    }
});

test("calendar todo CRUD and filter flow", async () => {
    const temp = await createTempCalendarPath();
    try {
        const created = await calendarStore.createCalendarTodoRecord(temp.dataPath, {
            title: "提交周报",
            date: "2026-03-20",
            status: "todo",
            priority: "high",
        });
        assert.equal(created.item.title, "提交周报");

        const listByDate = await calendarStore.listCalendarTodos(temp.dataPath, {date: "2026-03-20"});
        assert.equal(listByDate.count, 1);
        assert.equal(listByDate.items[0].priority, "high");

        const updated = await calendarStore.updateCalendarTodoRecord(temp.dataPath, {
            id: created.item.id,
            title: "提交周报-完成",
            date: "2026-03-20",
            status: "done",
        });
        assert.equal(updated.item.status, "done");

        const doneList = await calendarStore.listCalendarTodos(temp.dataPath, {
            startDate: "2026-03-01",
            endDate: "2026-03-31",
            status: "done",
        });
        assert.equal(doneList.count, 1);

        const deletedData = await calendarStore.deleteCalendarTodoRecord(temp.dataPath, created.item.id);
        assert.equal(deletedData.todos.length, 0);

        await assert.rejects(
            () => calendarStore.updateCalendarTodoRecord(temp.dataPath, {
                id: "missing",
                title: "x",
                date: "2026-03-20",
            }),
            /Todo not found/
        );
    } finally {
        await temp.cleanup();
    }
});

test("ai diary CRUD and query flow", async () => {
    const temp = await createTempCalendarPath();
    try {
        const created = await calendarStore.createAiDiaryRecord(temp.dataPath, {
            date: "2026-03-20",
            title: "今日小结",
            content: "完成了测试编写",
            mood: "平静",
        });
        assert.equal(created.item.source, "ai");

        const list = await calendarStore.listAiDiaries(temp.dataPath, {date: "2026-03-20", query: "测试"});
        assert.equal(list.count, 1);
        assert.equal(list.items[0].mood, "平静");

        const updated = await calendarStore.updateAiDiaryRecord(temp.dataPath, {
            id: created.item.id,
            date: "2026-03-20",
            content: "完成了测试并回归",
            mood: "兴奋",
        });
        assert.equal(updated.item.mood, "兴奋");

        const deleted = await calendarStore.deleteAiDiaryRecord(temp.dataPath, created.item.id);
        assert.equal(deleted.aiDiaries.length, 0);
    } finally {
        await temp.cleanup();
    }
});

test("getCalendarDayDetail includes local todos/diaries and builtin holidays", async () => {
    const temp = await createTempCalendarPath();
    try {
        const year = new Date().getFullYear();
        const date = `${year}-10-01`;
        await calendarStore.createCalendarTodoRecord(temp.dataPath, {
            title: "国庆计划",
            date,
        });
        await calendarStore.createAiDiaryRecord(temp.dataPath, {
            date,
            content: "国庆当天记录",
        });

        const detail = await calendarStore.getCalendarDayDetail(temp.dataPath, date, {useRemote: false});
        assert.equal(detail.date, date);
        assert.equal(detail.todos.length, 1);
        assert.equal(detail.aiDiaries.length, 1);
        assert.ok(detail.holidays.some((item) => String(item.name).includes("国庆")));
    } finally {
        await temp.cleanup();
    }
});

test("calendar store rejects impossible dates", async () => {
    const temp = await createTempCalendarPath();
    try {
        await assert.rejects(
            () => calendarStore.createCalendarTodoRecord(temp.dataPath, {
                title: "无效日期待办",
                date: "2026-02-31",
            }),
            /valid YYYY-MM-DD date/
        );

        await assert.rejects(
            () => calendarStore.createAiDiaryRecord(temp.dataPath, {
                date: "2026-13-01",
                content: "bad date",
            }),
            /valid YYYY-MM-DD date/
        );

        await assert.rejects(
            () => calendarStore.getCalendarDayDetail(temp.dataPath, "2026-00-01", {useRemote: false}),
            /valid YYYY-MM-DD date/
        );
    } finally {
        await temp.cleanup();
    }
});

test("calendar store rejects inverted date range filters", async () => {
    const temp = await createTempCalendarPath();
    try {
        await assert.rejects(
            () => calendarStore.listCalendarTodos(temp.dataPath, {
                startDate: "2026-03-31",
                endDate: "2026-03-01",
            }),
            /endDate must be greater than or equal to startDate/
        );

        await assert.rejects(
            () => calendarStore.listAiDiaries(temp.dataPath, {
                startDate: "2026-03-31",
                endDate: "2026-03-01",
            }),
            /endDate must be greater than or equal to startDate/
        );
    } finally {
        await temp.cleanup();
    }
});

test("getCalendarDayDetail includes workdays and computed flags", async () => {
    const temp = await createTempCalendarPath();
    try {
        const seeded = {
            todos: [],
            aiDiaries: [],
            holidays: [
                {name: "劳动节", startDate: "2026-05-01", endDate: "2026-05-03", type: "public", source: "local"},
            ],
            workdays: [
                {name: "调休补班", date: "2026-05-02", type: "workday", source: "local"},
            ],
        };
        await fs.writeFile(temp.dataPath, JSON.stringify(seeded, null, 2), "utf8");

        const detail = await calendarStore.getCalendarDayDetail(temp.dataPath, "2026-05-02", {useRemote: false});
        assert.equal(detail.date, "2026-05-02");
        assert.ok(detail.holidays.some((item) => item.name === "劳动节"));
        assert.equal(detail.workdays.length, 1);
        assert.equal(detail.isHoliday, true);
        assert.equal(detail.isWorkday, true);

        const normalWeekend = await calendarStore.getCalendarDayDetail(temp.dataPath, "2026-05-09", {useRemote: false});
        assert.equal(normalWeekend.isHoliday, false);
        assert.equal(normalWeekend.isWorkday, false);
    } finally {
        await temp.cleanup();
    }
});

test("readCalendarData overlays remote holiday and workday fallback", async () => {
    const temp = await createTempCalendarPath();
    const originalFetch = global.fetch;
    global.fetch = async () => ({
        ok: true,
        async json() {
            return {
                code: 0,
                holiday: {
                    "05-01": {holiday: true, name: "劳动节", target: "劳动节"},
                    "05-02": {holiday: false, name: "补班", target: "调休补班"},
                },
            };
        },
    });
    try {
        const data = await calendarStore.readCalendarData(temp.dataPath, {useRemote: true});
        assert.ok(data.holidays.some((item) => item.name.includes("劳动节")));
        assert.ok(data.workdays.some((item) => item.name.includes("调休补班") || item.name.includes("补班")));
    } finally {
        global.fetch = originalFetch;
        await temp.cleanup();
    }
});
