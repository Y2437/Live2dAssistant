# Live2dAssistant 项目架构与现状报告（2026-04-16）

## 0. 报告范围与方法

本报告基于当前仓库源码与文档进行盘点，覆盖：

- 主进程：`src/main/**`
- 渲染层：`src/renderer/js/**`、`src/renderer/view/**`、`src/renderer/css/**`
- 工程配置：`package.json`、`forge.config.js`
- 项目文档：`README.md`、`PROJECT_REQUIREMENTS_AND_ARCHITECTURE.md`、`docs/**`
- 测试与脚本：`tests/**`、`scripts/**`

说明：

- `node_modules/`、打包产物、第三方 vendor/minified 资源不做逐行实现分析。
- 本报告聚焦“当前仓库里真实存在什么、如何组织、哪里可能漂移或有风险”。
- 当前项目主路径是单窗口 `devShell` 模式，而不是传统多窗口产品形态。

---

## 1. 项目总体定位

`Live2dAssistant` 是一个基于 Electron Forge 的桌面助手应用，当前以 `devShell` 单壳模式作为主要交互形态。核心功能面包括：

- Live2D 看板娘交互
- 普通聊天与 Agent 工具编排
- 知识卡片管理
- 番茄钟任务管理
- 剪贴板快照与历史管理
- 日历计划、待办与 AI 日记
- 短期上下文与长期记忆提炼
- 模型提供商与模型设置管理

---

## 2. 仓库结构总览（当前）

### 2.1 顶层关键目录

- `src/main`：主进程、窗口、IPC、Agent、存储与配置
- `src/renderer`：视图、前端逻辑、样式、Live2D 资源与 vendor 文件
- `docs`：架构、样式、roadmap 等项目文档
- `tests`：主进程/领域层单元测试
- `scripts`：测试与检查脚本

### 2.2 工程栈

- Runtime: Electron `^40.1.0`
- 打包: Electron Forge `^7.11.1`
- 依赖特征：`marked`, `highlight.js`, `pixi.js`, `pixi-live2d-display`, `pdf-parse`, `zod`, `dotenv`, `@prisma/client`
- 项目形态：`commonjs`

### 2.3 当前可见文档

当前仓库中的主要文档为：

- `README.md`
- `PROJECT_REQUIREMENTS_AND_ARCHITECTURE.md`
- `docs/DEVELOPER_ARCHITECTURE_GUIDE.md`
- `docs/PROJECT_ARCHITECTURE_AND_STATUS_REPORT.md`
- `docs/CSS_STYLE_GUIDE.md`
- `docs/roadmap.md`

---

## 3. 运行时架构

### 3.1 进程分层

1. 主进程（Electron Main）
- Electron 生命周期
- 存储路径初始化
- 窗口管理
- IPC 注册
- JSON/JSONL 持久化
- Agent 与模型配置编排

2. preload 层
- `contextBridge` 暴露 `window.api`
- 将 invoke 和事件桥接为 renderer 可调用接口

3. renderer 层
- 壳层导航与视图切换
- assistant/cards/pomodoro/calendar/clipboard/settings 模块
- Live2D + Pixi UI 交互

### 3.2 启动链路

按执行顺序：

1. `src/main/main.js`
   - 初始化 `sessionData` / `cache` 等路径
   - `app.whenReady()` 后调用 `ipcRegister.registerAll()`
   - 启动每小时维护任务 `maybeRunDailyMemoryExtraction()`
   - 调用 `wm.open("assistant")`

2. `src/main/ipc/ipcRegister.js`
   - 加载上下文、长期记忆、知识卡片、memory routine、模型设置
   - 初始化 clipboard store / calendar plan / AgentService
   - 注册全部 handlers
   - 触发每日记忆维护与 AI diary 启动逻辑

3. `src/main/window/WindowManager.js`
   - 在 `devShell` 模式下，将业务视图路由到壳窗口
   - 通过 `ui:showView` 通知 renderer 切换页面

---

## 4. 窗口与视图模型

### 4.1 配置来源

文件：`src/main/config/index.js`

关键点：

- `WINDOW_MODE = "devShell"`
- `WINDOW_KEYS = [assistant, pomodoro, cards, clipboard, devShell]`
- `WINDOW_FILE_MAP` 指向：
  - `assistant.html`
  - `pomodoro.html`
  - `cards.html`
  - `clipboard.html`
  - `index.html`

### 4.2 当前模式行为

`devShell` 下的实际主入口：`src/renderer/view/index.html`

当前壳层导航包含：

- assistant
- pomodoro
- cards
- calendar
- clipboard
- settings

说明：

- `calendar` 和 `settings` 是壳内本地视图，不在 `WINDOW_KEYS` 中作为独立窗口暴露。
- `window.api.openWindow(key)` 对非独立业务页面会被转换成壳内视图切换。

---

## 5. IPC 契约与 API 映射

### 5.1 preload 暴露 API

文件：`src/main/preload.js`

当前 API 分组包括：

- 基础：`ping`, `openWindow`, `touch`, `onShowView`
- 对话：`chat`, `agentChat`, `agentChatStream`, `cancelAgentChat`
- 上下文/记忆：`getAiContextMeta`, `getAiContextData`, `clearAiContext`, `getLongTermMemoryData`, `getMemoryRoutineMeta`, `extractLongTermMemories`, `deleteLongTermMemory`
- 模型设置：`getModelProviderSettings`, `updateModelProviderSettings`, `testModelProviderPrompt`
- Agent 能力：`getAgentCapabilities`, `runAgentSelfTest`
- 番茄钟：`loadPomodoroJson`, `savePomodoroJson`
- 剪贴板：snapshot/history/capture/clear/delete/pin/copy
- 知识卡片：load/create/update/generateSummary/delete
- 日历 / todo / AI diary：load day detail / create-update-delete todo / list-create-update-delete diary

### 5.2 主进程 handler 注册

文件：`src/main/ipc/ipcRegisterHandlers.js`

当前 handler 分组为：

- core
- aiChat
- context
- modelProvider
- agent
- pomodoro
- clipboard
- knowledgeCard
- calendar

流式事件 channel：

- `app:agentChatStream:event`

取消机制：

- `app:agentChatCancel`
- main 侧通过 `AbortController` 管理进行中的流式请求

---

## 6. 数据持久化设计

当前主要业务数据落在 Electron `userData` 路径下，对应 `src/main/config/index.js`：

1. `assistant-context.json`
- 短期上下文

2. `assistant-conversation-log.jsonl`
- 对话日志

3. `assistant-long-term-memory.json`
- 长期记忆

4. `assistant-model-settings.json`
- 模型提供商与模型选择配置

5. `assistant-memory-routine.json`
- 每日提炼任务状态

6. `knowledge-cards.json`
- 知识卡片数据

7. `pomodoro.json`
- 番茄钟任务数据

8. `clipboard-history.json`
- 剪贴板历史

9. `calendar-plan.json`
- 日历计划、todo、AI 日记相关数据

10. `agent-screenshots/`
- Agent 视觉工具生成的截图/图片输出目录

---

## 7. Agent 架构（主进程）

### 7.1 模块分工

- `agentService.js`：Agent 多步循环、direct/normal mode、tool allowlist、trace/status/output
- `agentSearchTools.js`：搜索、网页、记忆、卡片、部分数据检索工具
- `agentVisionTools.js`：截图、剪贴板图片、图像分析等视觉工具
- `agentShared.js`：公共文本/搜索/抓取辅助能力
- `promptRegistry.js`：persona、工具 spec、Agent prompt 模板
- `assistantPrompt.js`：普通聊天与最终回答 prompt 组装
- `aiService.js`：模型请求与 SSE 解析

### 7.2 当前执行模式

1. Normal
- 多步规划 + 工具调用 + 最终回答
- 支持 trace/status 输出
- 有 `MAX_AGENT_STEPS` 限制

2. Direct
- 最多 0~1 次工具调用
- 更偏快速直接应答

### 7.3 当前工具面

结合代码可确认，当前 Agent 可涉及：

- 记忆读取 / 搜索 / 删除 / 提炼
- 卡片读取 / 搜索 / 创建 / 更新相关能力
- 番茄钟状态
- 剪贴板读取
- 截图 / 图像分析
- 网络搜索 / 网页读取
- calendar todo / AI diary 相关数据调用

### 7.4 现状判断

当前 Agent 主链路已经可用，但仍是“以业务闭环为核心的桌面 Agent”，不是通用型大型任务执行框架。

---

## 8. renderer 架构

### 8.1 壳层

文件：`src/renderer/js/shell/app.js`

职责：

- 统一导航
- 视图切换
- 与 `ui:showView` 对接
- settings 页面数据聚合

### 8.2 Assistant

文件：`src/renderer/js/assistant/index.js`

功能包括：

- Live2D 初始化
- 气泡与长回复右侧面板
- 流式文本渲染
- 取消 / 重试 / 超时
- execution summary / traces
- 工具范围选择与 direct mode

### 8.3 Cards

文件：`src/renderer/js/cards/index.js`

功能包括：

- 列表筛选、搜索、分页
- 新建 / 编辑 / 删除
- 摘要生成
- Markdown 预览

### 8.4 Pomodoro

文件：`src/renderer/js/pomodoro/index.js`

功能包括：

- 任务 CRUD
- edit / list / run 三态切换
- 工作 / 休息阶段循环

### 8.5 Clipboard

文件：`src/renderer/js/clipboard/index.js`

功能包括：

- 当前快照展示
- 历史列表管理
- 捕获 / 删除 / 置顶 / 回写

### 8.6 Calendar

文件：`src/renderer/js/calendar/index.js`

功能包括：

- 月历视图
- 日期详情
- todo 管理
- AI diary 相关交互

### 8.7 Settings

文件：`src/renderer/js/settings/view.js`

功能包括：

- 上下文 / 记忆 / 能力 / 自测 / 模型设置等内容的渲染辅助

---

## 9. 样式与主题层

当前 CSS 分层：

- `src/renderer/css/theme/light.css`
- `src/renderer/css/theme/dark.css`
- `src/renderer/css/style/shell.css`
- `src/renderer/css/style/views.css`
- `src/renderer/css/style/assistant.css`
- `src/renderer/css/style/cards.css`
- `src/renderer/css/style/pomodoro.css`
- `src/renderer/css/style/clipboard.css`
- `src/renderer/css/style/calendar.css`
- `src/renderer/css/style/settings.css`
- `src/renderer/css/style/standalone.css`

结论：样式层已经按 theme / shell / feature modules 分层，结构相对清晰。

---

## 10. 资源与第三方依赖现状

### 10.1 Live2D 资源

当前主要资源位于：

- `src/renderer/assets/live2d/Hiyori/**`

这是当前主交互的核心可视资源。

### 10.2 Vendor

当前 vendored 前端依赖包括：

- Pixi
- Live2D core / Cubism runtime
- Marked 分发包
- `highlight-lite.mjs`

---

## 11. 当前现状总结

### 11.1 已实现结构

- 单壳大窗口主交互模式可用
- assistant 主交互链路可用
- Agent 流式输出和工具编排已接通
- knowledge cards / pomodoro / clipboard / calendar 已在代码中有完整模块存在
- 记忆系统、模型设置与 AI diary 已进入主进程结构

### 11.2 当前文档层已修正的历史漂移点

本轮对照源码可确认，旧文档中的以下内容已经不适合作为当前真相：

- QuickFloat 相关结构不应再作为当前主架构主线描述
- `npm test` 不再等于 `scripts/auto-test.js`
- docs 数量不再是 1 个
- renderer 活跃功能面不再只有 assistant/cards/pomodoro/settings

### 11.3 当前风险与关注点

1. `ipcRegister.js` 仍然偏大
- 虽然已有 store 拆分，但它仍然承担较多聚合、初始化与业务协调逻辑

2. 文档容易再次漂移
- preload API、handlers 分组、renderer 壳层导航都在演进，若改代码不改文档，容易再次失真

3. renderer 自动化验证仍不足
- 当前测试重点仍偏主进程与 store/utils，UI 行为缺少系统性自动验证

4. 资源与打包体积仍值得关注
- Live2D 资源和 vendor 文件仍然是较大的静态负担

---

## 12. 测试与脚本现状

### 12.1 当前脚本

来自 `package.json`：

- `npm test` -> `node scripts/run-tests.js`
- `npm run test:auto` -> `node scripts/auto-test.js`
- `npm run test:unit` -> `node scripts/run-unit-tests.js`
- `npm run lint:css`
- `npm run lint:css:fix`

### 12.2 当前测试面

`tests/` 当前主要覆盖：

- `agentShared.test.js`
- `assistantPrompt.test.js`
- `calendarStore.test.js`
- `clipboardStore.test.js`
- `ipcDataUtils.test.js`
- `pomodoroStore.test.js`
- `promptRegistry.test.js`

结论：

- 后端/领域层已有基础单测
- renderer UI 仍缺少完整自动化测试体系

---

## 13. 建议的下一步

1. 持续控制 `ipcRegister.js` 体量
2. 让文档维护跟随 preload / handlers / shell 结构变更同步更新
3. 在关键 renderer 交互上建立更可靠的回归验证
4. 继续治理静态资源与打包体积

---

## 14. 结论

当前仓库已经形成较清晰的 Electron 单壳桌面助手结构：

- main 负责状态、持久化与 Agent 编排
- preload 负责边界隔离与 API 暴露
- renderer 负责壳层导航与功能模块交互
- cards / pomodoro / clipboard / calendar / settings 已成为当前真实功能面的一部分

后续维护的关键不是再增加更多分散入口，而是继续提升：

- 主链路稳定性
- Agent 执行质量
- 文档与代码一致性
- renderer 回归验证能力
