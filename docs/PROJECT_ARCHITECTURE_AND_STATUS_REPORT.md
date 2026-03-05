# Live2dAssistant 项目架构与现状报告（2026-03-05）

## 0. 报告范围与方法

本报告基于仓库本地源码与文档进行逐层审阅，覆盖：
- 主进程：`src/main/**`
- 渲染层：`src/renderer/js/**`、`src/renderer/view/**`、`src/renderer/css/**`
- 资源与第三方：`src/renderer/assets/**`、`src/renderer/vendor/**`
- 工程配置与文档：根目录 `package.json`、`forge.config.js`、`README.md`、`PROJECT_REQUIREMENTS_AND_ARCHITECTURE.md`、`docs/roadmap.md`

说明：
- `node_modules/`、`out/` 属于依赖和构建产物，不纳入架构设计主体分析。
- 对第三方 minified/vendor 文件与大体积二进制资源，采用“清单+用途+接入点”方式审计，不逐行解释其内部实现。

---

## 1. 项目总体定位

`Live2dAssistant` 是一个 Electron 桌面助手应用，当前以“大窗口模式（devShell）”为主交互面板，核心能力为：
- Live2D 看板娘交互
- 聊天与 Agent 工具编排
- 知识卡片管理
- 番茄钟任务管理
- 记忆提炼（短期上下文 -> 长期记忆）
- 视觉/剪贴板/联网工具调用

---

## 2. 仓库结构总览（当前）

关键目录规模：
- `src/main`: 15 文件 / 144,413 bytes
- `src/renderer/js`: 8 文件 / 123,179 bytes
- `src/renderer/view`: 6 文件 / 67,004 bytes
- `src/renderer/css`: 10 文件 / 102,022 bytes
- `src/renderer/assets`: 45 文件 / 50,223,352 bytes
- `src/renderer/vendor`: 16 文件 / 1,263,625 bytes
- `docs`: 1 文件 / 2,379 bytes

工程栈：
- Runtime: Electron `^40.1.0`
- 打包: Electron Forge `^7.11.1` + fuses plugin
- 主要依赖: `marked`, `highlight.js`, `pixi.js`, `pixi-live2d-display`, `pdf-parse`, `dotenv`

环境变量键（`.env`）：
- `AI_PROVIDER`
- `AI_MODEL`
- `AI_VISION_MODEL`
- `AI_SUMMARY_MODEL`
- `API_KEY`
- `BASE_URL`

---

## 3. 运行时架构

### 3.1 进程分层

1. 主进程（Electron Main）
- 生命周期启动、窗口管理、IPC 注册
- 本地 JSON 数据持久化
- Agent 服务编排与工具调用

2. 渲染进程（Renderer）
- Shell 导航与视图切换
- Assistant/Cards/Pomodoro/Settings 前端交互
- Live2D + Pixi 渲染

3. 预加载层（Preload）
- 通过 `contextBridge` 暴露 `window.api`
- 渲染层仅走受控 IPC，不直接访问 Node API

### 3.2 启动链路

按执行顺序：
1. `src/main/main.js`
- 配置 sessionData 路径（`LOCALAPPDATA/live2dassistant/SessionData`）
- `app.whenReady()` 后调用 `ipcRegister.registerAll()`
- 启动定时维护：每小时执行 `maybeRunDailyMemoryExtraction()`
- 打开 `assistant` 窗口（devShell 模式会在壳窗口内切换视图）

2. `src/main/ipc/ipcRegister.js`
- 加载上下文/记忆/卡片/日常任务元数据
- 初始化 `AgentService`
- 注册 IPC handlers（core/chat/context/agent/pomodoro/cards）

3. `src/main/window/WindowManager.js`
- 根据 `WINDOW_MODE` 决定：多窗口模式或 `devShell` 单壳模式
- 在 `devShell` 下，`open(windowKey)` 实际通过 `ui:showView` 事件通知壳页面切视图

---

## 4. 窗口与视图模型

### 4.1 配置来源

文件：`src/main/config/index.js`
- `WINDOW_MODE = "devShell"`
- `WINDOW_KEYS = [assistant, pomodoro, cards, clipboard, devShell]`
- `WINDOW_FILE_MAP` 指向对应 HTML

### 4.2 当前模式行为

`devShell` 下：
- 实际可见主窗口是 `src/renderer/view/index.html`
- 导航按钮在同一窗口内切换：`assistant / pomodoro / cards / clipboard / settings`
- `window.api.openWindow(key)` 在壳模式下转成 `ui:showView`

---

## 5. IPC 契约与 API 映射

### 5.1 Preload 暴露 API

文件：`src/main/preload.js`
- 基础：`ping`, `openWindow`, `touch`
- 对话：`chat`, `agentChat`, `agentChatStream`, `cancelAgentChat`
- 上下文/记忆：`getAiContextMeta`, `getAiContextData`, `clearAiContext`, `getLongTermMemoryData`, `getMemoryRoutineMeta`, `extractLongTermMemories`, `deleteLongTermMemory`
- Agent能力：`getAgentCapabilities`, `runAgentSelfTest`
- 番茄钟：`loadPomodoroJson`, `savePomodoroJson`
- 知识卡片：`loadKnowledgeCards`, `createKnowledgeCard`, `updateKnowledgeCard`, `generateKnowledgeCardSummary`, `deleteKnowledgeCard`

### 5.2 主进程 handler 注册

文件：`src/main/ipc/ipcRegisterHandlers.js`
- 与 preload 端 channel 完整对齐
- 流式事件专用 channel：`app:agentChatStream:event`
- 支持取消中止（`AbortController`）

---

## 6. 数据持久化设计

所有业务数据均写入 Electron `userData` 路径（见 `src/main/config/index.js`）：

1. `assistant-context.json`
- 短期上下文
- 结构：`[{ role: "user|assistant", message: string }]`
- 限制：最多保留 48 条

2. `assistant-long-term-memory.json`
- 长期记忆
- 字段：`id/title/content/source/category/tags/confidence/status/fingerprint/createdAt/updatedAt`
- 含去重逻辑（指纹+文本包含关系）

3. `assistant-memory-routine.json`
- 每日提炼任务元数据
- 字段：`lastExtractionDate/lastRunAt/lastStatus/lastAddedCount/lastSkippedCount/lastError`

4. `knowledge-cards.json`
- 知识卡片
- 字段：`id/title/content/summary/category/source/createdAt/updatedAt`

5. `pomodoro.json`
- 番茄钟任务
- 数组项：`id/title/workTime/restTime/repeatTimes`

6. `agent-screenshots/`
- Agent 视觉工具输出截图目录

---

## 7. Agent 架构（主进程）

### 7.1 模块分工

- `agentService.js`: 编排主循环（规划、工具、最终回答）
- `agentSearchTools.js`: 搜索/网页读取/卡片与记忆检索
- `agentVisionTools.js`: 剪贴板、截图、图像分析
- `agentShared.js`: 公共工具函数（文本清洗、抓取、搜索变体/评分）
- `promptRegistry.js`: persona + 各类系统提示词模板
- `aiService.js`: 对接大模型 HTTP API（含 SSE 流式解析）

### 7.2 执行模式

1. Normal（默认）
- 先做 prefetch 规划（当前 `buildPrefetchPlan` 返回空，依赖 LLM 规划）
- 最多 `MAX_AGENT_STEPS=20` 步的思考/工具循环
- 每步产出 trace
- 最后进入 `finalizeAgentResponse`，由独立最终回答 prompt 生成人设回复

2. Direct（前端“直接调用”开关）
- 只允许 0~1 次工具调用
- 不走完整多步循环
- 工具结果直接进入最终回复提示词

### 7.3 当前工具清单（promptRegistry）

- 上下文/记忆：`get_context/get_memory/search_memory/get_memory_routine_status/add_memory/delete_memory/extract_memory`
- 卡片：`list_cards/search_cards/get_card/create_card`
- 任务/系统：`get_pomodoro_status/get_clipboard`
- 视觉：`analyze_clipboard_image/capture_screen/list_screenshots/analyze_image`
- 网络：`web_search/read_web_page`

### 7.4 网络工具策略

`web_search` 当前实现：
- 查询变体生成 + 多来源抓取（Bing RSS、Bing HTML、DuckDuckGo HTML）
- 结果融合去重打分
- 前 3 条尝试正文抓取，其余仅保留摘要

风险：页面结构变化会导致解析脆弱。

---

## 8. 渲染层架构

### 8.1 壳层

文件：`src/renderer/js/shell/app.js`
- 统一导航与视图切换
- settings 页内同步上下文/记忆/Agent能力/自测
- 监听 `ui:showView` 以支持 devShell 模式路由

### 8.2 Assistant

文件：`src/renderer/js/assistant/index.js`
- Live2D 初始化（Pixi + model3.json）
- Bubble 与右侧 Chat 双形态
- 流式文本渲染 + 取消/超时/重试
- 运行轨迹面板（status + traces）
- 工具作用域选择（基础能力常开，扩展能力可选）

### 8.3 Cards

文件：`src/renderer/js/cards/index.js`
- 列表筛选、搜索、分页
- 选中/双击详情/编辑器双栏（编辑+预览）
- 新建/编辑/删除 + 摘要生成
- 本地 JSON 持久化通过 IPC

### 8.4 Pomodoro

文件：`src/renderer/js/pomodoro/index.js`
- 任务 CRUD + 拖拽排序
- edit/list/run 三态页面
- 计时阶段（work/rest）与循环控制
- 波浪 + 彩虹边框 + confetti 视觉反馈

### 8.5 Settings 视图

文件：`src/renderer/js/settings/view.js`
- 纯渲染函数集合
- 上下文、长期记忆、Agent 能力、自测结果列表渲染

---

## 9. 主题与样式层

- `shell.css`：整体框架与导航
- `views.css`：view 容器、转场、占位卡片
- `assistant.css`：看板娘、气泡、聊天、运行面板、scope 菜单
- `cards.css`：卡片浏览/编辑/模态/markdown 排版
- `pomodoro.css`：番茄钟三态 UI 与动画
- `settings.css`：设置卡片、记录列表、按钮
- `light.css` / `dark.css`：统一语义变量与组件映射

结论：主题分层清晰，结构化程度较高。

---

## 10. 资源与第三方依赖现状

### 10.1 Live2D 资源

当前资源目录包含 3 套主要内容：
- `Hiyori`（当前默认接入）
- `hiyori_pro_zh`（大体积备选/素材）
- `Roxy`（已被 `.gitignore` 指向忽略，但本地仍存在）

备注：`src/renderer/assets` 总体积约 50MB，资源冗余较明显。

### 10.2 Vendor

- `pixi.min.js`
- `live2dcubismcore.min.js`
- `cubism4.min.js`
- `marked` 全量分发包
- `highlight-lite.mjs`

---

## 11. 当前现状报告（能力、变更、问题）

### 11.1 已实现能力

- 大窗口模式主流程可运行
- Agent 流式对话与工具编排已接通
- 记忆提炼/卡片持久化链路已接通
- 番茄钟完整交互链路已接通

### 11.2 本轮清理后的状态（与“资料管理器”相关）

经关键字扫描（`organizer`/`资料管理器`/`search_library` 等）与代码审阅：
- 大窗口模式已移除资料管理器入口、样式、脚本、工具注册与 IPC
- 相关文件已删除或去引用
- 文档层已同步移除相关叙述

### 11.3 发现的问题与风险

1. 独立窗口页面脚本引用失效（高优先级）
- `src/renderer/view/assistant.html` 引用 `../js/assistant.js`（不存在）
- `src/renderer/view/pomodoro.html` 引用 `../js/pomodoro.js`（不存在）
- 实际脚本位于：`../js/assistant/index.js`、`../js/pomodoro/index.js`

2. `ipcRegister.js` 体量过大（中优先级）
- 仍存在“状态+持久化+业务+初始化”混合职责
- 已拆出 handlers 与 AgentService，但核心类仍是重模块

3. 自动化测试缺失（高优先级）
- `npm test` 仍为占位命令
- Agent/IPC/数据规范缺少单元与回归测试

4. 网页抓取策略脆弱（中优先级）
- 依赖搜索结果 HTML 结构解析，来源易变

5. 资源体积偏大（中优先级）
- assets 中存在未启用的模型资源，打包体积会受影响

---

## 12. 一致性与健康检查结果

已执行：
- 主进程 JS 语法检查：`node --check src/main/**/*.js` 通过
- 关键字残留扫描（资料管理器相关）未命中
- 本地引用完整性扫描：发现 2 处失效引用（见 11.3）

未执行：
- E2E/UI 自动化测试（项目未配置）
- 打包产物验证（本轮未执行 `electron-forge package/make`）

---

## 13. 当前 git 工作区状态

当前存在未提交修改（与本轮清理一致）：
- 多个主进程/渲染层文件 `M`
- 资料管理器相关文件 `D`

说明：这属于“清理进行中”的正常状态，尚未形成提交快照。

---

## 14. 建议的下一步（按优先级）

1. 先修复独立窗口失效脚本引用
- `assistant.html` / `pomodoro.html` 指向 `index.js` 子路径

2. 增加最小回归测试
- IPC channel contract
- memory/cards 数据规范化函数
- Agent tool allowlist 与 parse

3. 继续瘦身 `ipcRegister.js`
- 把记忆/卡片持久化服务再拆模块

4. 资源治理
- 清理未使用 Live2D 素材或改为按需打包

5. 文档统一
- 将本报告与 `PROJECT_REQUIREMENTS_AND_ARCHITECTURE.md`/`docs/roadmap.md` 建立引用关系，避免漂移

---

## 15. 文件级索引（附录）

> 下表由仓库文件扫描生成，便于按路径定位模块职责与规模。

| Path | Kind | Lines | Bytes |
| --- | root | ---: | ---: |
| docs\PROJECT_ARCHITECTURE_AND_STATUS_REPORT.md | docs | 261 | 11760 |
| docs\roadmap.md | docs | 65 | 2379 |
| forge.config.js | root | 43 | 1172 |
| package.json | root | 44 | 1302 |
| package-lock.json | root | 9055 | 327284 |
| PROJECT_REQUIREMENTS_AND_ARCHITECTURE.md | root | 167 | 5428 |
| promptRegistry.backup.js | root | 311 | 17229 |
| README.md | root | 4 | 282 |
| src\main\config\env.js | main | 13 | 428 |
| src\main\config\index.js | main | 127 | 10423 |
| src\main\ipc\agentSearchTools.js | main | 420 | 18555 |
| src\main\ipc\agentService.js | main | 640 | 25148 |
| src\main\ipc\agentShared.js | main | 248 | 8563 |
| src\main\ipc\agentVisionTools.js | main | 92 | 4305 |
| src\main\ipc\aiService.js | main | 187 | 6338 |
| src\main\ipc\assistantPrompt.js | main | 38 | 1139 |
| src\main\ipc\ipcDataUtils.js | main | 202 | 8258 |
| src\main\ipc\ipcRegister.js | main | 582 | 23344 |
| src\main\ipc\ipcRegisterHandlers.js | main | 192 | 8480 |
| src\main\ipc\promptRegistry.js | main | 381 | 20186 |
| src\main\main.js | main | 42 | 1540 |
| src\main\preload.js | main | 68 | 3831 |
| src\main\window\WindowManager.js | main | 119 | 3875 |
| src\renderer\assets\live2d\Hiyori\Hiyori.2048\texture_00.png | assets | 15294 | 1814312 |
| src\renderer\assets\live2d\Hiyori\Hiyori.2048\texture_01.png | assets | 21362 | 2504416 |
| src\renderer\assets\live2d\Hiyori\Hiyori.cdi3.json | assets | 523 | 9660 |
| src\renderer\assets\live2d\Hiyori\Hiyori.moc3 | assets | 2421 | 443648 |
| src\renderer\assets\live2d\Hiyori\Hiyori.model3.json | assets | 93 | 1736 |
| src\renderer\assets\live2d\Hiyori\Hiyori.physics3.json | assets | 1569 | 26160 |
| src\renderer\assets\live2d\Hiyori\Hiyori.pose3.json | assets | 16 | 166 |
| src\renderer\assets\live2d\Hiyori\Hiyori.userdata3.json | assets | 44 | 623 |
| src\renderer\assets\live2d\Hiyori\motions\Hiyori_m01.motion3.json | assets | 1085 | 10622 |
| src\renderer\assets\live2d\Hiyori\motions\Hiyori_m02.motion3.json | assets | 1478 | 14248 |
| src\renderer\assets\live2d\Hiyori\motions\Hiyori_m03.motion3.json | assets | 1331 | 12732 |
| src\renderer\assets\live2d\Hiyori\motions\Hiyori_m04.motion3.json | assets | 882 | 8772 |
| src\renderer\assets\live2d\Hiyori\motions\Hiyori_m05.motion3.json | assets | 1670 | 16061 |
| src\renderer\assets\live2d\Hiyori\motions\Hiyori_m06.motion3.json | assets | 1990 | 19492 |
| src\renderer\assets\live2d\Hiyori\motions\Hiyori_m07.motion3.json | assets | 991 | 9636 |
| src\renderer\assets\live2d\Hiyori\motions\Hiyori_m08.motion3.json | assets | 1087 | 10551 |
| src\renderer\assets\live2d\Hiyori\motions\Hiyori_m09.motion3.json | assets | 1198 | 11479 |
| src\renderer\assets\live2d\Hiyori\motions\Hiyori_m10.motion3.json | assets | 974 | 9604 |
| src\renderer\css\style\assistant.css | renderer-css | 938 | 23870 |
| src\renderer\css\style\cards.css | renderer-css | 940 | 19091 |
| src\renderer\css\style\clipboard.css | renderer-css | 7 | 116 |
| src\renderer\css\style\pomodoro.css | renderer-css | 547 | 17956 |
| src\renderer\css\style\settings.css | renderer-css | 180 | 3458 |
| src\renderer\css\style\shell.css | renderer-css | 178 | 4252 |
| src\renderer\css\style\standalone.css | renderer-css | 49 | 840 |
| src\renderer\css\style\views.css | renderer-css | 93 | 2231 |
| src\renderer\css\theme\dark.css | renderer-css | 344 | 15000 |
| src\renderer\css\theme\light.css | renderer-css | 344 | 15208 |
| src\renderer\js\assistant\index.js | renderer-js | 901 | 34654 |
| src\renderer\js\cards\index.js | renderer-js | 866 | 33790 |
| src\renderer\js\cards\markdown.js | renderer-js | 31 | 901 |
| src\renderer\js\core\config.js | renderer-js | 121 | 5328 |
| src\renderer\js\pomodoro\index.js | renderer-js | 808 | 30436 |
| src\renderer\js\settings\view.js | renderer-js | 103 | 4416 |
| src\renderer\js\shared\dom.js | renderer-js | 10 | 406 |
| src\renderer\js\shell\app.js | renderer-js | 335 | 13248 |
| src\renderer\vendor\highlight-lite.mjs | vendor | 211 | 7254 |
| src\renderer\vendor\live2d\cubism4.min.js | vendor | 2 | 143728 |
| src\renderer\vendor\live2d\live2dcubismcore.min.js | vendor | 9 | 207155 |
| src\renderer\vendor\marked\bin\main.js | vendor | 248 | 6656 |
| src\renderer\vendor\marked\bin\marked.js | vendor | 12 | 264 |
| src\renderer\vendor\marked\lib\marked.d.ts | vendor | 757 | 26039 |
| src\renderer\vendor\marked\lib\marked.esm.js | vendor | 70 | 41633 |
| src\renderer\vendor\marked\lib\marked.esm.js.map | vendor | 7 | 156845 |
| src\renderer\vendor\marked\lib\marked.umd.js | vendor | 72 | 42512 |
| src\renderer\vendor\marked\lib\marked.umd.js.map | vendor | 7 | 157353 |
| src\renderer\vendor\marked\LICENSE.md | vendor | 32 | 2942 |
| src\renderer\vendor\marked\man\marked.1 | vendor | 110 | 2429 |
| src\renderer\vendor\marked\man\marked.1.md | vendor | 61 | 1970 |
| src\renderer\vendor\marked\package.json | vendor | 103 | 3396 |
| src\renderer\vendor\marked\README.md | vendor | 79 | 3116 |
| src\renderer\vendor\pixi\pixi.min.js | vendor | 9 | 460333 |
| src\renderer\view\assistant.html | renderer-view | 58 | 2942 |
| src\renderer\view\cards.html | renderer-view | 30 | 1200 |
| src\renderer\view\clipboard.html | renderer-view | 30 | 1237 |
| src\renderer\view\index.html | renderer-view | 476 | 43084 |
| src\renderer\view\Live2d.html | renderer-view | 10 | 159 |
| src\renderer\view\pomodoro.html | renderer-view | 208 | 18382 |


## 16. IPC Channel 清单（附录）

### 16.1 Renderer -> Main（preload invoke）
- app:agentChat
- app:agentChatCancel
- app:agentChatStream
- app:aiChat
- app:clearAiContext
- app:createKnowledgeCard
- app:deleteKnowledgeCard
- app:deleteLongTermMemory
- app:extractLongTermMemories
- app:generateKnowledgeCardSummary
- app:getAgentCapabilities
- app:getAiContextData
- app:getAiContextMeta
- app:getLongTermMemoryData
- app:getMemoryRoutineMeta
- app:loadKnowledgeCards
- app:loadPomodoroJson
- app:openWindow
- app:ping
- app:runAgentSelfTest
- app:savePomodoroJson
- app:touch
- app:updateKnowledgeCard

### 16.2 Main Handle 注册
- app:agentChat
- app:agentChatCancel
- app:agentChatStream
- app:aiChat
- app:clearAiContext
- app:createKnowledgeCard
- app:deleteKnowledgeCard
- app:deleteLongTermMemory
- app:extractLongTermMemories
- app:generateKnowledgeCardSummary
- app:getAgentCapabilities
- app:getAiContextData
- app:getAiContextMeta
- app:getLongTermMemoryData
- app:getMemoryRoutineMeta
- app:loadKnowledgeCards
- app:loadPomodoroJson
- app:openWindow
- app:ping
- app:runAgentSelfTest
- app:savePomodoroJson
- app:touch
- app:updateKnowledgeCard

## 17. 工具能力清单（附录）
- add_memory
- analyze_clipboard_image
- analyze_image
- capture_screen
- create_card
- delete_memory
- extract_memory
- get_card
- get_clipboard
- get_context
- get_memory
- get_memory_routine_status
- get_pomodoro_status
- list_cards
- list_screenshots
- read_web_page
- search_cards
- search_memory
- web_search
