# Live2dAssistant 开发者架构手册

文档版本：v2.0  
快照日期：2026-04-16  
适用范围：当前仓库工作区（Electron 主进程 + preload + renderer 单壳模式）

## 1. 文档目标

本手册用于给后续开发人员提供当前代码结构的可执行参考，重点说明：

- 当前运行时分层与职责边界
- 启动链路、窗口模型与 `devShell` 单壳模式
- IPC 契约、主进程聚合层、Agent 编排与本地持久化
- renderer 侧壳层与功能模块拆分
- 新功能接入时应复用的现有路径
- 文档与代码如何保持一致

这是一份工程实现文档，不是产品 PRD。所有结论均应以当前源码为准。

## 2. 项目概览

`Live2dAssistant` 是一个基于 Electron Forge 的桌面助手应用。当前主交互模式是 `devShell` 单壳窗口，核心功能包括：

- Live2D 看板娘交互与情绪反馈
- 普通对话与 Agent 对话
- 知识卡片管理
- 番茄钟任务管理
- 剪贴板快照与历史管理
- 日历计划、待办与 AI 日记
- 短期上下文与长期记忆系统
- 模型提供商与模型配置管理

## 3. 技术栈与工程形态

- 运行时：`electron@^40.1.0`
- 打包：Electron Forge
- 语言：JavaScript（项目为 `commonjs`，renderer 侧通过 `<script type="module">` 组织模块）
- 关键依赖：`pixi.js`, `pixi-live2d-display`, `marked`, `highlight.js`, `dotenv`, `zod`, `pdf-parse`
- 持久化：主进程本地 JSON / JSONL 文件
- Agent：主进程编排 + 工具调用 + 流式输出

`package.json` 当前脚本：

- `npm start`
- `npm test`
- `npm run test:auto`
- `npm run test:unit`
- `npm run lint:css`
- `npm run lint:css:fix`
- `npm run package`
- `npm run make`

## 4. 仓库结构（开发最相关部分）

```text
src/
  main/
    main.js                         # 主进程入口
    preload.js                      # renderer 安全桥接 API
    config/
      index.js                      # 常量、路径、窗口映射、运行时配置
      env.js                        # 环境变量装配
    window/
      WindowManager.js              # 窗口创建与单壳路由策略
    ipc/
      ipcRegister.js                # 主进程聚合层
      ipcRegisterHandlers.js        # IPC channel 注册层
      aiService.js                  # 模型请求与 SSE 流式解析
      agentService.js               # Agent 主循环编排
      agentSearchTools.js           # 搜索 / 网页 / 检索类工具
      agentVisionTools.js           # 截图 / 图像相关工具
      agentShared.js                # Agent 公共函数
      assistantPrompt.js            # 对话 prompt 组装
      promptRegistry.js             # persona / tool spec / prompt 模板
      ipcDataUtils.js               # 数据归一化与校验工具
      pomodoroStore.js              # 番茄钟领域存储
      clipboardStore.js             # 剪贴板领域存储
      calendarStore.js              # 日历 / todo / diary 领域存储
      modelProviderCatalog.js       # 模型提供商目录
  renderer/
    view/                           # HTML 视图
    js/
      shell/app.js                  # 单壳导航与视图切换
      assistant/index.js            # 对话 + Live2D + 流式呈现
      cards/index.js                # 卡片页
      pomodoro/index.js             # 番茄钟页
      clipboard/index.js            # 剪贴板页
      calendar/index.js             # 日历页
      settings/view.js              # 设置页渲染函数
      core/config.js                # renderer 常量
      shared/                       # DOM / perf 共享工具
    css/
      style/                        # 功能与布局样式
      theme/                        # 明暗主题 token 与映射
    assets/                         # Live2D 资源
    vendor/                         # vendored 前端依赖
scripts/
  run-tests.js
  auto-test.js
  run-unit-tests.js
tests/
docs/
```

## 5. 运行时架构

### 5.1 进程分层

1. 主进程（`src/main/**`）
- Electron 生命周期
- 窗口创建与 `devShell` 路由
- IPC channel 注册
- 本地 JSON / JSONL 持久化
- Agent、memory、calendar、clipboard 等业务编排

2. preload 层（`src/main/preload.js`）
- 通过 `contextBridge.exposeInMainWorld("api", ...)` 暴露受控 API
- renderer 仅通过 `window.api` 调主进程
- 负责流式事件监听与 invoke 包装

3. 渲染进程（`src/renderer/**`）
- 壳层导航与 view 切换
- Assistant / Cards / Pomodoro / Clipboard / Calendar / Settings UI
- Live2D/Pixi 渲染与用户交互

### 5.2 启动链路

启动顺序以 `src/main/main.js` 为准：

1. `configureElectronStoragePaths()` 初始化 `sessionData`、`cache` 等 Electron 存储路径。
2. `app.whenReady()` 后调用 `ipcRegister.registerAll()`。
3. 启动每小时一次的后台维护任务，当前维护项是 `maybeRunDailyMemoryExtraction()`。
4. 调用 `wm.open("assistant")` 打开主界面。
5. 当 `WINDOW_MODE === "devShell"` 时，实际显示的是壳窗口 `src/renderer/view/index.html`，业务视图在壳内切换。

### 5.3 窗口与路由模型

配置位于 `src/main/config/index.js`：

- `WINDOW_MODE = "devShell"`
- `WINDOW_KEYS = [assistant, pomodoro, cards, clipboard, devShell]`
- `WINDOW_FILE_MAP` 指向对应 HTML 文件

`src/main/window/WindowManager.js` 的行为：

- 在 `devShell` 模式下，`assistant` / `pomodoro` / `cards` / `clipboard` 这类非独立窗口实际被路由到 `devShell` 壳窗口。
- 主进程通过 `ui:showView` 事件通知 renderer 壳层切换视图。
- 统一使用：
  - `nodeIntegration: false`
  - `contextIsolation: true`
  - `preload: src/main/preload.js`

## 6. 主进程模块职责边界

### 6.1 `ipcRegister.js`：主进程聚合层

这是当前主进程的组合中心，负责：

- 持有与加载短期上下文、长期记忆、知识卡片、剪贴板、日历计划、模型设置等状态
- 初始化 `AgentService`
- 调用各领域 store 与工具服务
- 对外暴露统一业务方法供 handlers 调用
- 启动时执行 register/load/ensure 逻辑

当前 `registerAll()` 中的核心工作包括：

- 加载 assistant context
- 加载长期记忆
- 加载 knowledge cards
- 加载 memory routine metadata
- 加载 model provider settings
- 初始化 clipboard store / calendar plan / pomodoro 相关数据
- 初始化 `AgentService`
- 注册全部 IPC handlers
- 触发每日记忆提炼与 AI diary 启动流程

### 6.2 `ipcRegisterHandlers.js`：IPC 契约层

职责：

- 统一注册 `ipcMain.handle(...)`
- 将 channel 按领域分组
- 保持 handlers 只做协议映射，不直接持有业务状态

当前分组：

- `registerCoreHandlers`
- `registerAiChatHandlers`
- `registerContextHandlers`
- `registerModelProviderHandlers`
- `registerAgentHandlers`
- `registerPomodoroHandlers`
- `registerClipboardHandlers`
- `registerKnowledgeCardHandlers`
- `registerCalendarHandlers`

### 6.3 `aiService.js`：模型调用层

职责：

- 封装模型请求
- 处理流式输出解析
- 为普通对话、Agent、摘要、视觉分析等能力提供统一请求接口

模型相关运行时配置最终由：

- `src/main/config/env.js`
- `src/main/ipc/modelProviderCatalog.js`
- `src/main/ipc/ipcRegister.js` 中的 model provider settings

共同决定。

### 6.4 `agentService.js`：Agent 编排核心

职责：

- Agent 多步循环
- direct mode / normal mode 分流
- `allowedTools` 白名单控制
- trace / status / final answer 流式回调
- 与 search/vision/shared 工具层协作

相关辅助模块：

- `agentSearchTools.js`
- `agentVisionTools.js`
- `agentShared.js`
- `promptRegistry.js`
- `assistantPrompt.js`

### 6.5 领域存储模块

当前已经拆分出的领域持久化模块包括：

- `pomodoroStore.js`
- `clipboardStore.js`
- `calendarStore.js`

这些模块负责各自领域的：

- JSON 文件存在性保障
- 入参校验
- 归一化
- create / update / delete / list 等持久化操作

### 6.6 `ipcDataUtils.js`

职责：

- assistant context 归一化
- long-term memory 归一化与去噪/指纹辅助
- knowledge card payload 校验与标准化
- memory category / tags / confidence / status 规范化

## 7. preload API 与 IPC 契约

### 7.1 preload 暴露方式

`src/main/preload.js` 中通过 `contextBridge.exposeInMainWorld("api", ...)` 暴露 `window.api`。

当前重要事件：

- `app:agentChatStream:event`
- `ui:showView`

### 7.2 当前 API 分组

#### 基础与窗口
- `ping`
- `openWindow`
- `touch`
- `onShowView`

#### 对话与 Agent
- `chat`
- `agentChat`
- `agentChatStream`
- `cancelAgentChat`
- `getAgentCapabilities`
- `runAgentSelfTest`

#### 上下文与记忆
- `getAiContextMeta`
- `getAiContextData`
- `clearAiContext`
- `getLongTermMemoryData`
- `getMemoryRoutineMeta`
- `extractLongTermMemories`
- `deleteLongTermMemory`

#### 模型提供商设置
- `getModelProviderSettings`
- `updateModelProviderSettings`
- `testModelProviderPrompt`

#### 番茄钟
- `loadPomodoroJson`
- `savePomodoroJson`

#### 剪贴板
- `getClipboardSnapshot`
- `getClipboardHistory`
- `captureClipboard`
- `clearClipboardHistory`
- `deleteClipboardItem`
- `pinClipboardItem`
- `copyClipboardItem`

#### 知识卡片
- `loadKnowledgeCards`
- `createKnowledgeCard`
- `updateKnowledgeCard`
- `generateKnowledgeCardSummary`
- `deleteKnowledgeCard`

#### 日历 / todo / AI diary
- `loadCalendarPlan`
- `getCalendarDayDetail`
- `createCalendarTodo`
- `updateCalendarTodo`
- `deleteCalendarTodo`
- `listAiDiaries`
- `createAiDiary`
- `updateAiDiary`
- `deleteAiDiary`

### 7.3 Agent 流式链路

- renderer 调用 `window.api.agentChatStream(...)`
- preload 监听 `app:agentChatStream:event`
- main 侧 `ipcRegisterHandlers.js` 中使用 `event.sender.send(...)` 回推：
  - `status`
  - `trace`
  - `content`
  - `error`
  - `canceled`
  - `complete`
- 取消通过 `app:agentChatCancel`
- main 内部使用 `AbortController` 管理活跃请求

## 8. renderer 架构

### 8.1 壳层 `src/renderer/js/shell/app.js`

职责：

- 导航按钮绑定
- 当前 view 切换
- 接收 `ui:showView`
- 与 settings / feature view 做基础联动

`src/renderer/view/index.html` 当前实际导航视图：

- `assistant`
- `pomodoro`
- `cards`
- `calendar`
- `clipboard`
- `settings`

### 8.2 Assistant

文件：`src/renderer/js/assistant/index.js`

职责：

- Live2D 与 Pixi 初始化
- 气泡模式 + 右侧聊天面板双形态
- Agent 流式文本渲染
- 重试 / 取消 / 超时处理
- 执行摘要与 traces 面板
- 扩展工具范围选择与 direct mode 开关

### 8.3 Cards

文件：`src/renderer/js/cards/index.js`

职责：

- 卡片列表、筛选、分页
- 新建 / 更新 / 删除
- 摘要生成
- Markdown 预览

### 8.4 Pomodoro

文件：`src/renderer/js/pomodoro/index.js`

职责：

- 任务 CRUD
- list / edit / run 视图切换
- 工作 / 休息阶段循环控制

### 8.5 Clipboard

文件：`src/renderer/js/clipboard/index.js`

职责：

- 当前剪贴板快照
- 历史列表
- 手动捕获 / 删除 / 置顶 / 回写

### 8.6 Calendar

文件：`src/renderer/js/calendar/index.js`

职责：

- 日历面板
- 日期详情
- todo 管理
- AI diary 相关视图与调用

### 8.7 Settings

文件：`src/renderer/js/settings/view.js`

职责：

- 上下文、长期记忆、能力、自测、模型设置等视图渲染辅助

## 9. 视图与样式层

### 9.1 HTML 视图

当前主要视图：

- `src/renderer/view/index.html`
- `src/renderer/view/assistant.html`
- `src/renderer/view/pomodoro.html`
- `src/renderer/view/cards.html`
- `src/renderer/view/clipboard.html`
- `src/renderer/view/Live2d.html`

其中 `index.html` 是当前主壳入口。

### 9.2 CSS 分层

- `src/renderer/css/theme/*.css`：主题 token 与明暗模式映射
- `src/renderer/css/style/shell.css`：壳层与导航
- `src/renderer/css/style/views.css`：视图容器与转场基础
- `src/renderer/css/style/assistant.css`
- `src/renderer/css/style/cards.css`
- `src/renderer/css/style/pomodoro.css`
- `src/renderer/css/style/clipboard.css`
- `src/renderer/css/style/calendar.css`
- `src/renderer/css/style/settings.css`
- `src/renderer/css/style/standalone.css`

## 10. 持久化数据模型

所有业务数据均落在 Electron `userData` 路径下，关键路径定义在 `src/main/config/index.js`：

- `assistant-context.json`：短期上下文
- `assistant-conversation-log.jsonl`：对话日志
- `assistant-long-term-memory.json`：长期记忆
- `assistant-model-settings.json`：模型提供商与模型设置
- `assistant-memory-routine.json`：每日记忆提炼元数据
- `knowledge-cards.json`：知识卡片
- `pomodoro.json`：番茄钟任务
- `clipboard-history.json`：剪贴板历史
- `calendar-plan.json`：日历计划/待办/AI diary 相关数据
- `agent-screenshots/`：截图与视觉工具输出目录

## 11. 环境变量与模型配置

### 11.1 环境变量

`src/main/config/env.js` 当前读取：

- `AI_PROVIDER`
- `AI_MODEL`
- `AI_SUMMARY_MODEL`
- `AI_VISION_MODEL`
- `VISION_MODEL`
- `AI_API_PATH`
- `AI_REQUEST_FORMAT`
- `BASE_URL`
- `API_KEY`

### 11.2 运行时模型设置

模型相关配置支持两层来源：

1. `.env` 默认值
2. `assistant-model-settings.json` 中的用户本地设置

模型提供商相关逻辑集中在 `ipcRegister.js` 与 `modelProviderCatalog.js`。

## 12. 安全边界与工程约束

- `BrowserWindow` 使用 `nodeIntegration: false`
- `contextIsolation: true`
- renderer 不直接访问文件系统或 Node API
- 所有业务持久化由 main 进程集中处理
- renderer 必须通过 preload 暴露的 `window.api` 与 main 通信

## 13. 自动化与验证基线

当前可用验证命令：

- `npm test`
- `npm run test:auto`
- `npm run test:unit`
- `npm run lint:css`

已知测试重点偏向主进程 / store / utils / prompt 模块，renderer UI 自动化仍未建立完整体系。

## 14. 新功能接入建议

### 14.1 新增一个 IPC 能力

推荐顺序：

1. 在 `ipcRegister.js` 增加或复用业务方法
2. 在 `ipcRegisterHandlers.js` 注册 `ipcMain.handle`
3. 在 `preload.js` 暴露 `window.api` 方法
4. 在 renderer 页面接入调用
5. 更新相关文档与测试

### 14.2 新增一个 Agent 工具

推荐顺序：

1. 在 `promptRegistry.js` 增加工具 spec
2. 在 `agentService.js` 接入执行流
3. 在 `agentSearchTools.js` 或 `agentVisionTools.js` 实现逻辑
4. 检查 `allowedTools` 白名单行为
5. 通过 `runAgentSelfTest` 或测试脚本验证

### 14.3 新增一个本地持久化领域

推荐模式：

- 新建 `xxxStore.js` 负责校验 + 读写 + 归一化
- `ipcRegister.js` 做聚合与委托
- `ipcRegisterHandlers.js` 只做协议映射

## 15. 文档维护原则

- 文档中的路径、IPC channel、功能面必须能在当前代码中找到。
- 结构真相优先写在本手册中，其他文档只写摘要或状态，不要重复维护整份大表。
- 如果改动了以下任一内容，应同步更新本手册：
  - preload API
  - `ipcRegisterHandlers.js` channel 分组
  - `index.html` 壳层视图结构
  - `package.json` 脚本
  - `config/index.js` 中的持久化路径
