const fs = require("fs/promises");
const path = require("path");
const {clipboard, desktopCapturer} = require("electron");
const {aiChatWithModel} = require("./aiService");
const {AGENT_SCREENSHOT_DIR_PATH, ENV_CONFIG} = require("../config");
const {sanitizeFileName} = require("./agentShared");

// Screen, clipboard, and vision helpers for multimodal agent tools.

async function getPomodoroStatus(service) {
    const tasks = await service.getPomodoroData();
    return {
        taskCount: tasks.length,
        tasks: tasks.slice(0, 12).map((item) => ({
            id: item.id,
            title: item.title,
            workMinutes: Math.round((Number(item.workTime) || 0) / 60000),
            restMinutes: Math.round((Number(item.restTime) || 0) / 60000),
            repeatTimes: Number(item.repeatTimes) || 0,
        })),
    };
}

function getClipboardSnapshot() {
    const text = clipboard.readText();
    const image = clipboard.readImage();
    const size = image?.isEmpty?.() ? {width: 0, height: 0} : image.getSize();
    return {
        hasText: Boolean(text),
        text: text ? text.slice(0, 4000) : "",
        hasImage: !image.isEmpty(),
        imageWidth: size.width || 0,
        imageHeight: size.height || 0,
    };
}

async function captureScreen(name) {
    const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {width: 1920, height: 1080},
        fetchWindowIcons: false,
    });
    if (!sources.length) throw new Error("No screen source available.");
    const source = sources[0];
    const image = source.thumbnail;
    if (!image || image.isEmpty()) throw new Error("Capture failed.");
    const safeName = sanitizeFileName(name || source.name || "screen");
    const filePath = path.join(AGENT_SCREENSHOT_DIR_PATH, `${Date.now()}-${safeName}.png`);
    await fs.writeFile(filePath, image.toPNG());
    return {name: source.name, imagePath: filePath, width: image.getSize().width, height: image.getSize().height};
}

async function analyzeImage(args) {
    const imagePath = String(args?.imagePath || "").trim();
    const prompt = String(args?.prompt || "Please describe the key information in this image.").trim();
    if (!imagePath) throw new Error("imagePath is required.");
    const model = ENV_CONFIG.AI_VISION_MODEL || ENV_CONFIG.VISION_MODEL;
    if (!model) throw new Error("Missing vision model configuration.");
    const buffer = await fs.readFile(imagePath);
    const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
    const response = await aiChatWithModel([
        {
            role: "system",
            content: [{type: "text", text: "You are an image analysis tool. Return only concise, objective observations in Chinese."}],
        },
        {
            role: "user",
            content: [{type: "text", text: prompt}, {type: "image_url", image_url: {url: dataUrl}}],
        },
    ], {model, temperature: 0.1, maxTokens: 512});
    return {imagePath, analysis: response?.choices?.[0]?.message?.content ?? ""};
}

async function listScreenshots() {
    const entries = await fs.readdir(AGENT_SCREENSHOT_DIR_PATH, {withFileTypes: true}).catch(() => []);
    const files = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const fullPath = path.join(AGENT_SCREENSHOT_DIR_PATH, entry.name);
        const stat = await fs.stat(fullPath).catch(() => null);
        files.push({name: entry.name, imagePath: fullPath, updatedAt: stat?.mtime?.toISOString?.() || "", size: stat?.size || 0});
    }
    files.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return {items: files.slice(0, 20)};
}

async function analyzeClipboardImage(service, args = {}) {
    const image = clipboard.readImage();
    if (!image || image.isEmpty()) throw new Error("Clipboard image is empty.");
    const filePath = path.join(AGENT_SCREENSHOT_DIR_PATH, `${Date.now()}-clipboard.png`);
    await fs.writeFile(filePath, image.toPNG());
    return analyzeImage({imagePath: filePath, prompt: args.prompt || "Analyze the clipboard image."});
}

module.exports = {getPomodoroStatus, getClipboardSnapshot, captureScreen, analyzeImage, listScreenshots, analyzeClipboardImage};
