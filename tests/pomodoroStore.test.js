const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const pomodoroStore = require("../src/main/ipc/pomodoroStore");

async function createTempPomodoroPath() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "live2d-pomodoro-"));
    return {
        dir,
        dataPath: path.join(dir, "pomodoro.json"),
        async cleanup() {
            await fs.rm(dir, {recursive: true, force: true});
        },
    };
}

test("ensurePomodoroJson creates missing file", async () => {
    const temp = await createTempPomodoroPath();
    try {
        const data = await pomodoroStore.ensurePomodoroJson(temp.dataPath);
        assert.deepEqual(data, []);
        const raw = await fs.readFile(temp.dataPath, "utf8");
        assert.deepEqual(JSON.parse(raw), []);
    } finally {
        await temp.cleanup();
    }
});

test("savePomodoroTaskList validates data and normalizes duplicate ids", async () => {
    const temp = await createTempPomodoroPath();
    try {
        const tasks = await pomodoroStore.savePomodoroTaskList(temp.dataPath, [
            {id: 1, title: "任务1", workTime: 25 * 60000, restTime: 5 * 60000, repeatTimes: 4},
            {id: 1, title: "任务2", workTime: 30 * 60000, restTime: 10 * 60000, repeatTimes: 3},
        ]);
        assert.equal(tasks.length, 2);
        assert.deepEqual(tasks.map((item) => item.id), [1, 2]);
        await assert.rejects(
            () => pomodoroStore.savePomodoroTaskList(temp.dataPath, [{title: "", workTime: 10, restTime: 10, repeatTimes: 1}]),
            /Pomodoro task title is required/
        );
    } finally {
        await temp.cleanup();
    }
});

test("create update delete pomodoro task record", async () => {
    const temp = await createTempPomodoroPath();
    try {
        await pomodoroStore.ensurePomodoroJson(temp.dataPath);

        const created = await pomodoroStore.createPomodoroTaskRecord(temp.dataPath, {
            title: "学习",
            workMinutes: 25,
            restMinutes: 5,
            repeatTimes: 4,
        });
        assert.equal(created.count, 1);
        assert.equal(created.task.id, 1);
        assert.equal(created.task.workTime, 25 * 60000);

        const updated = await pomodoroStore.updatePomodoroTaskRecord(temp.dataPath, {
            id: 1,
            title: "学习-更新",
            workMinutes: 30,
            restMinutes: 10,
            repeatTimes: 2,
        });
        assert.equal(updated.count, 1);
        assert.equal(updated.task.title, "学习-更新");
        assert.equal(updated.task.restTime, 10 * 60000);

        const deleted = await pomodoroStore.deletePomodoroTaskRecord(temp.dataPath, 1);
        assert.equal(deleted.deletedId, 1);
        assert.equal(deleted.count, 0);

        await assert.rejects(
            () => pomodoroStore.updatePomodoroTaskRecord(temp.dataPath, {
                id: 999,
                title: "not-found",
                workMinutes: 20,
                restMinutes: 5,
                repeatTimes: 2,
            }),
            /Pomodoro task not found/
        );
    } finally {
        await temp.cleanup();
    }
});

test("createPomodoroTaskRecord validates payload", async () => {
    const temp = await createTempPomodoroPath();
    try {
        await assert.rejects(
            () => pomodoroStore.createPomodoroTaskRecord(temp.dataPath, {
                title: "x",
                workMinutes: 0,
                restMinutes: 5,
                repeatTimes: 1,
            }),
            /workMinutes must be between 1 and 99/
        );
        await assert.rejects(
            () => pomodoroStore.deletePomodoroTaskRecord(temp.dataPath, "bad-id"),
            /Pomodoro task id is required/
        );
    } finally {
        await temp.cleanup();
    }
});
