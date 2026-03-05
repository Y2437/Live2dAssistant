import { escapeHtml } from "../shared/dom.js";

export function renderEmptyRecord(text) {
    return `
        <article class="settings-record settings-record--empty">
            <p class="settings-record__body">${escapeHtml(text)}</p>
        </article>
    `;
}

export function renderContextList(items) {
    if (!items.length) {
        return renderEmptyRecord("No short-term context yet.");
    }
    return items.map((item, index) => `
        <article class="settings-record">
            <div class="settings-record__head">
                <h5 class="settings-record__title">${item.role === "assistant" ? "Assistant" : "User"} #${index + 1}</h5>
                <span class="settings-record__meta">${escapeHtml(item.role)}</span>
            </div>
            <p class="settings-record__body">${escapeHtml(item.message)}</p>
        </article>
    `).join("");
}

export function renderMemoryList(items) {
    if (!items.length) {
        return renderEmptyRecord("No long-term memory yet.");
    }
    return items.map((item) => `
        <article class="settings-record">
            <div class="settings-record__head">
                <div>
                    <h5 class="settings-record__title">${escapeHtml(item.title)}</h5>
                    <span class="settings-record__meta">${escapeHtml(item.category || "reference")} · ${escapeHtml(item.source || "manual")} · ${escapeHtml(item.status || "active")}</span>
                </div>
                <button type="button" class="settings-record__action" data-action="delete-memory" data-memory-id="${escapeHtml(item.id)}">Delete</button>
            </div>
            <p class="settings-record__body">${escapeHtml(item.content)}</p>
            <p class="settings-record__meta">${escapeHtml((item.tags || []).join(", ") || "no tags")} · confidence ${escapeHtml(String(item.confidence ?? ""))}</p>
        </article>
    `).join("");
}

export function renderAgentCapabilityList(capabilities) {
    if (!capabilities) {
        return renderEmptyRecord("Agent capability data is unavailable.");
    }
    const items = [
        ["Vision model", capabilities.visionEnabled ? "enabled" : "disabled"],
        ["Tool count", String(Array.isArray(capabilities.tools) ? capabilities.tools.length : 0)],
    ];
    return items.map(([title, value]) => `
        <article class="settings-record">
            <div class="settings-record__head">
                <h5 class="settings-record__title">${escapeHtml(title)}</h5>
            </div>
            <p class="settings-record__body">${escapeHtml(value)}</p>
        </article>
    `).join("");
}

export function renderAgentToolList(tools) {
    if (!Array.isArray(tools) || !tools.length) {
        return renderEmptyRecord("No tools exposed.");
    }
    return tools.map((toolName) => `
        <article class="settings-record">
            <div class="settings-record__head">
                <h5 class="settings-record__title">${escapeHtml(toolName)}</h5>
            </div>
        </article>
    `).join("");
}

function stringifyPreview(value) {
    if (value == null) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch (error) {
        return String(value);
    }
}

export function renderAgentSelfTestList(result) {
    if (!result?.traces?.length) {
        return renderEmptyRecord("No self-test result yet.");
    }
    return result.traces.map((trace) => {
        const preview = stringifyPreview(trace.outputPreview);
        return `
            <article class="settings-record">
                <div class="settings-record__head">
                    <div class="settings-record__headBlock">
                        <h5 class="settings-record__title">${escapeHtml(trace.tool || "unknown")}</h5>
                        <span class="settings-record__meta">${escapeHtml(trace.phase || "self-test")}</span>
                    </div>
                    <span class="settings-statusPill" data-status="${escapeHtml(trace.status || "idle")}">${escapeHtml(trace.status || "idle")}</span>
                </div>
                <p class="settings-record__meta">input: ${escapeHtml(stringifyPreview(trace.input || {}))}</p>
                <p class="settings-record__body">${escapeHtml(preview || "No output preview.")}</p>
            </article>
        `;
    }).join("");
}
