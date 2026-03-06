const fs = require("fs/promises");

async function ensurePomodoroJsonExists(dataPath) {
    return JSON.parse(await fs.readFile(dataPath, "utf8"));
}

async function ensurePomodoroJson(dataPath) {
    try {
        return await ensurePomodoroJsonExists(dataPath);
    } catch (error) {
        if (error.code === "ENOENT") {
            await fs.writeFile(dataPath, "[]", "utf-8");
            return [];
        }
        throw error;
    }
}

function normalizePomodoroTaskPayload(data, options = {}) {
    const title = typeof data?.title === "string" ? data.title.trim() : "";
    if (!title) {
        throw new Error("Pomodoro task title is required.");
    }
    const workMinutes = Number(data?.workMinutes);
    const restMinutes = Number(data?.restMinutes);
    const repeatTimes = Number(data?.repeatTimes);
    if (!Number.isFinite(workMinutes) || workMinutes <= 0 || workMinutes > 99) {
        throw new Error("workMinutes must be between 1 and 99.");
    }
    if (!Number.isFinite(restMinutes) || restMinutes <= 0 || restMinutes > 99) {
        throw new Error("restMinutes must be between 1 and 99.");
    }
    if (!Number.isFinite(repeatTimes) || repeatTimes <= 0 || repeatTimes > 99) {
        throw new Error("repeatTimes must be between 1 and 99.");
    }
    const idRaw = options.requireId ? Number(data?.id) : null;
    const id = Number.isFinite(idRaw) ? idRaw : null;
    if (options.requireId && id == null) {
        throw new Error("Pomodoro task id is required.");
    }
    return {
        id,
        title,
        workTime: Math.round(workMinutes * 60000),
        restTime: Math.round(restMinutes * 60000),
        repeatTimes: Math.round(repeatTimes),
    };
}

function normalizePomodoroTaskList(data) {
    if (!Array.isArray(data)) {
        throw new Error("Pomodoro payload must be an array.");
    }
    const maxMinutesMs = 99 * 60000;
    const seenIds = new Set();
    let nextId = 1;
    return data.map((item) => {
        const title = typeof item?.title === "string" ? item.title.trim() : "";
        if (!title) {
            throw new Error("Pomodoro task title is required.");
        }
        const workTime = Math.round(Number(item?.workTime));
        const restTime = Math.round(Number(item?.restTime));
        const repeatTimes = Math.round(Number(item?.repeatTimes));
        if (!Number.isFinite(workTime) || workTime <= 0 || workTime > maxMinutesMs) {
            throw new Error("Pomodoro task workTime must be between 1 and 99 minutes.");
        }
        if (!Number.isFinite(restTime) || restTime <= 0 || restTime > maxMinutesMs) {
            throw new Error("Pomodoro task restTime must be between 1 and 99 minutes.");
        }
        if (!Number.isFinite(repeatTimes) || repeatTimes <= 0 || repeatTimes > 99) {
            throw new Error("Pomodoro task repeatTimes must be between 1 and 99.");
        }
        const rawId = Math.round(Number(item?.id));
        const id = Number.isFinite(rawId) && rawId > 0 && !seenIds.has(rawId)
            ? rawId
            : nextId;
        seenIds.add(id);
        nextId = Math.max(nextId, id + 1);
        return {
            id,
            title,
            workTime,
            restTime,
            repeatTimes,
        };
    });
}

function getNextPomodoroTaskId(tasks = []) {
    const maxId = tasks.reduce((max, item) => Math.max(max, Number(item?.id) || 0), 0);
    return maxId + 1;
}

async function savePomodoroTaskList(dataPath, data) {
    const tasks = normalizePomodoroTaskList(data);
    await fs.writeFile(dataPath, JSON.stringify(tasks, null, 2), "utf-8");
    return tasks;
}

async function createPomodoroTaskRecord(dataPath, data) {
    const payload = normalizePomodoroTaskPayload(data);
    const tasks = await ensurePomodoroJson(dataPath);
    const nextTask = {
        id: getNextPomodoroTaskId(tasks),
        title: payload.title,
        workTime: payload.workTime,
        restTime: payload.restTime,
        repeatTimes: payload.repeatTimes,
    };
    const next = [...tasks, nextTask];
    await fs.writeFile(dataPath, JSON.stringify(next, null, 2), "utf-8");
    return {task: nextTask, count: next.length};
}

async function updatePomodoroTaskRecord(dataPath, data) {
    const payload = normalizePomodoroTaskPayload(data, {requireId: true});
    const tasks = await ensurePomodoroJson(dataPath);
    const index = tasks.findIndex((item) => Number(item?.id) === payload.id);
    if (index === -1) {
        throw new Error("Pomodoro task not found.");
    }
    tasks[index] = {
        ...tasks[index],
        title: payload.title,
        workTime: payload.workTime,
        restTime: payload.restTime,
        repeatTimes: payload.repeatTimes,
    };
    await fs.writeFile(dataPath, JSON.stringify(tasks, null, 2), "utf-8");
    return {task: tasks[index], count: tasks.length};
}

async function deletePomodoroTaskRecord(dataPath, taskId) {
    const id = Number(taskId);
    if (!Number.isFinite(id)) {
        throw new Error("Pomodoro task id is required.");
    }
    const tasks = await ensurePomodoroJson(dataPath);
    const next = tasks.filter((item) => Number(item?.id) !== id);
    if (next.length === tasks.length) {
        throw new Error("Pomodoro task not found.");
    }
    await fs.writeFile(dataPath, JSON.stringify(next, null, 2), "utf-8");
    return {deletedId: id, count: next.length};
}

module.exports = {
    ensurePomodoroJson,
    savePomodoroTaskList,
    createPomodoroTaskRecord,
    updatePomodoroTaskRecord,
    deletePomodoroTaskRecord,
};
