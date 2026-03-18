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

test("readCalendarData drops broken records during normalization", async () => {
    const temp = await createTempCalendarPath();
    try {
        const broken = {
            todos: [{title: "", date: "bad-date"}, {title: "ok", date: "2026-03-20"}],
            aiDiaries: [{date: "2026-03-20", content: ""}, {date: "2026-03-20", content: "valid"}],
            holidays: [{name: "", date: "2026-01-01"}],
            workdays: [{date: "2026-02-08", name: "调休"}],
        };
        await fs.writeFile(temp.dataPath, JSON.stringify(broken, null, 2), "utf8");
        const data = await calendarStore.readCalendarData(temp.dataPath, {useRemote: false});
        assert.equal(data.todos.length, 1);
        assert.equal(data.aiDiaries.length, 1);
        assert.ok(data.holidays.length > 0);
        assert.equal(data.workdays.length, 1);
    } finally {
        await temp.cleanup();
    }
});
