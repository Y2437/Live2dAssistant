# Live2dAssistant 开发者架构手册

文档版本：v1.0  
快照日期：2026-03-06  
适用分支：当前仓库工作区（Electron 主进程 + Renderer 单壳模式）

## 1. 文档目标

本手册用于给后续开发人员提供可执行的工程参考，覆盖以下内容：

- 当前架构分层与职责边界
- 主流程启动链路与关键运行机制
- IPC 契约、数据持久化模型、Agent 编排机制
- 新功能接入与重构时必须遵守的工程规范
- 交付前测试基线与风险清单

本手册是“工程实施文档”，不是产品 PRD。重点是：如何安全迭代而不破坏现有系统。

## 2. 项目概览

Live2dAssistant 是一个基于 Electron 的桌面助手应用。当前主交互模式为 `devShell` 单壳窗口，核心能力包括：

- Live2D 看板娘交互与情绪动作映射
- AI 对话（普通模式 + Agent 模式）
- 知识卡片管理（本地 JSON 持久化）
- 番茄钟任务管理
- 短期上下文与长期记忆管理
- 剪贴板快照与历史管理
- QuickFloat（选中文本捕获 + 快速翻译/解释）

## 3. 技术栈与工程形态

- 运行时：`electron@^40.1.0`
- 语言：JavaScript（CommonJS + ESM 混合，Renderer 侧以 ESM 为主）
- 打包：Electron Forge
- 关键依赖：`pixi.js`, `pixi-live2d-display`, `marked`, `highlight.js`, `dotenv`
- 持久化：主进程本地 JSON 文件
- Agent：主进程编排 + 多工具调用 + 流式输出

工程脚本（`package.json`）：

- `npm start`: 本地开发启动
- `npm test`: 自动化基线检查（`scripts/auto-test.js`）
- `npm package`: 打包目录产物
- `npm make`: 生成安装包

## 4. 仓库结构（与开发最相关）

```text
src/
  main/
    main.js                         # 主进程入口
    preload.js                      # Renderer 安全桥接 API
    config/
      index.js                      # 常量、路径、窗口映射、触摸文案
      env.js                        # 环境变量装配
    window/
      WindowManager.js              # 窗口创建与切换策略
    ipc/
      ipcRegister.js                # 主进程状态编排中心（聚合层）
      ipcRegisterHandlers.js        # IPC channel 注册层（契约层）
      aiService.js                  # 大模型调用与流式实现
      agentService.js               # Agent 主循环编排
      agentSearchTools.js           # 搜索/网页/卡片/记忆检索工具
      agentVisionTools.js           # 视觉相关工具
      agentShared.js                # Agent 公共函数
      assistantPrompt.js            # 助手回复提示词
      promptRegistry.js             # Agent 工具说明与提示词
      ipcDataUtils.js               # 数据归一化与校验工具
      pomodoroStore.js              # 番茄钟领域存储（新拆分）
      clipboardStore.js             # 剪贴板领域存储（新拆分）
    quickFloat/
      selectionCoordinator.js       # 选区监控与 quickFloat 协调
  renderer/
    view/                           # HTML 视图
    js/
      shell/app.js                  # 单壳导航与设置页聚合
      assistant/index.js            # 对话页 + Live2D + 流式呈现
      cards/index.js                # 卡片页
      pomodoro/index.js             # 番茄钟页
      clipboard/index.js            # 剪贴板页
      settings/view.js              # 设置页视图渲染函数
      core/config.js                # Renderer 侧常量
    css/                            # 主题与模块样式
docs/
  PROJECT_ARCHITECTURE_AND_STATUS_REPORT.md
  roadmap.md
scripts/
  auto-test.js                      # 当前自动化检查基线
```

## 5. 运行时架构

### 5.1 进程分层

1. 主进程（`src/main/**`）
- 生命周期、窗口、IPC、持久化、Agent 编排

2. 预加载层（`src/main/preload.js`）
- 通过 `contextBridge` 暴露 `window.api`
- Renderer 不能直接访问 Node API

3. 渲染进程（`src/renderer/**`）
- 页面渲染、交互逻辑、Live2D 动画

### 5.2 启动链路（关键）

应用启动顺序如下：

1. `main.js` 初始化 Electron 存储路径（`sessionData/cache`）
2. `app.whenReady()` 后执行 `ipcRegister.registerAll()`
3. 初始化 QuickFloat 协调器并注册全局快捷键
4. 启动每小时一次的后台记忆维护任务
5. 打开 `assistant`（在 `devShell` 下实际为壳窗口切视图）

## 6. 窗口与路由模型

### 6.1 当前默认模式：`devShell`

配置位于 `src/main/config/index.js`：

- `WINDOW_MODE = "devShell"`
- 业务视图在同一壳窗口内切换（`assistant/pomodoro/cards/clipboard/settings`）
- 主进程通过 `ui:showView` 事件通知壳页面切换

### 6.2 特殊独立窗口：`quickFloat`

`WindowManager` 将 `quickFloat` 视为独立窗口，具备：

- 无边框、置顶、最小高度约束
- 支持动态切换展开/收起尺寸
- 与壳窗口并行存在

## 7. 主进程模块职责边界

### 7.1 `ipcRegister.js`（聚合层）

职责定位：

- 持有跨域状态（上下文、记忆、卡片缓存、routine 元数据）
- 对外暴露统一业务方法，供 handlers 调用
- 在 `registerAll()` 完成所有初始化与依赖注入

不再承担的职责（已拆分）：

- 番茄钟数据校验/CRUD 细节 -> `pomodoroStore.js`
- 剪贴板历史去重/置顶/回写细节 -> `clipboardStore.js`

### 7.2 `ipcRegisterHandlers.js`（契约层）

职责定位：

- 唯一的 `ipcMain.handle` 注册点
- 做参数入口校验 + 调用 registry 方法
- 不直接操作业务状态

这样可以将“协议层”和“业务层”解耦，便于后续单测。

### 7.3 `pomodoroStore.js`（领域存储）

职责：

- `pomodoro.json` 文件存在性保障
- 任务入参校验（分钟范围、重复次数、ID）
- 列表归一化、创建/更新/删除持久化

### 7.4 `clipboardStore.js`（领域存储）

职责：

- 剪贴板快照读取（文本 + 图片预览）
- 指纹去重、置顶顺序维护、容量裁剪
- 历史持久化、回写系统剪贴板

当前默认容量：120 条（由 `createClipboardStore` 初始化参数提供）。

### 7.5 `agentService.js`（编排核心）

职责：

- Agent 思考循环（最大步数限制）
- 工具调用权限控制（allowlist）
- 轨迹输出（trace/status）与流式文本回调
- direct mode 与 normal mode 分流

### 7.6 `ipcDataUtils.js`（数据规范化）

职责：

- 上下文/记忆/卡片字段归一化
- 记忆分类、标签、置信度、状态规则
- 摘要 fallback 文本处理

## 8. Renderer 架构

### 8.1 壳层（`shell/app.js`）

- 统一导航切换
- 设置页数据聚合拉取
- 监听 `ui:showView` 实现主进程驱动的视图切换

### 8.2 助手页（`assistant/index.js`）

- Live2D/Pixi 初始化与生命周期控制
- 气泡模式 + 右侧聊天面板自动切换
- Agent 流式输出与取消、超时、重试
- 运行轨迹面板（status + traces）
- 工具范围选择（allowedTools）与 direct mode

### 8.3 卡片页（`cards/index.js`）

- 列表、筛选、搜索、分页
- 新建/编辑/删除
- 摘要生成与 Markdown 预览

### 8.4 番茄钟页（`pomodoro/index.js`）

- 任务 CRUD 与排序
- 计时阶段控制与回合逻辑

### 8.5 剪贴板页（`clipboard/index.js`）

- 当前剪贴板快照展示
- 历史记录管理与回填

### 8.6 设置页（`settings/view.js`）

- 上下文、记忆、能力、自测结果渲染

## 9. IPC 契约（当前完整集合）

说明：以下均为 Renderer 通过 `window.api` 调用主进程 `app:*` channel。

### 9.1 基础与窗口

- `app:ping`
- `app:openWindow`
- `app:touch`

### 9.2 对话与 Agent

- `app:aiChat`
- `app:extractEmotionForLive2d`
- `app:agentChat`
- `app:agentChatStream`
- `app:agentChatCancel`
- `app:getAgentCapabilities`
- `app:runAgentSelfTest`

流式事件：

- 主进程 -> Renderer: `app:agentChatStream:event`

### 9.3 上下文与记忆

- `app:getAiContextMeta`
- `app:getAiContextData`
- `app:clearAiContext`
- `app:getLongTermMemoryData`
- `app:getMemoryRoutineMeta`
- `app:extractLongTermMemories`
- `app:deleteLongTermMemory`

### 9.4 知识卡片

- `app:loadKnowledgeCards`
- `app:createKnowledgeCard`
- `app:updateKnowledgeCard`
- `app:generateKnowledgeCardSummary`
- `app:deleteKnowledgeCard`

### 9.5 番茄钟

- `app:loadPomodoroJson`
- `app:savePomodoroJson`

### 9.6 剪贴板

- `app:getClipboardSnapshot`
- `app:getClipboardHistory`
- `app:captureClipboard`
- `app:clearClipboardHistory`
- `app:deleteClipboardItem`
- `app:pinClipboardItem`
- `app:copyClipboardItem`

### 9.7 QuickFloat

- `app:getQuickFloatFeatureState`
- `app:quickFloatCaptureSelectionText`
- `app:quickTranslateText`
- `app:quickExplainText`
- `app:quickFloatSetWindowMode`
- `app:quickFloatSetInteractionState`

QuickFloat 事件：

- `quick-float:feature-toggled`
- `quick-float:selection-ready`
- `quick-float:selection-error`

## 10. 持久化数据模型

所有数据均落在 `app.getPath("userData")` 下。

### 10.1 `assistant-context.json`

用途：短期对话上下文  
结构：

```json
[
  {"role":"user|assistant","message":"string"}
]
```

约束：最多保留 48 条。

### 10.2 `assistant-long-term-memory.json`

用途：长期记忆  
核心字段：

- `id`
- `title`
- `content`
- `source`
- `category`
- `tags`
- `confidence`
- `status`
- `fingerprint`
- `createdAt`
- `updatedAt`

包含去重策略：指纹命中 + 标题/内容相似性检查。

### 10.3 `assistant-memory-routine.json`

用途：每日自动提炼任务状态  
字段：

- `lastExtractionDate`
- `lastRunAt`
- `lastStatus`
- `lastAddedCount`
- `lastSkippedCount`
- `lastError`

### 10.4 `knowledge-cards.json`

用途：知识卡片  
字段：

- `id`
- `title`
- `content`
- `summary`
- `category`
- `source`
- `createdAt`
- `updatedAt`

### 10.5 `pomodoro.json`

用途：番茄钟任务  
字段：

- `id`
- `title`
- `workTime`（毫秒）
- `restTime`（毫秒）
- `repeatTimes`

### 10.6 `clipboard-history.json`

用途：剪贴板历史  
字段：

- `id`
- `type` (`text|image|mixed`)
- `text`
- `textPreview`
- `hasImage`
- `imageWidth`
- `imageHeight`
- `imageDataUrl`
- `source`
- `pinned`
- `fingerprint`
- `createdAt`

### 10.7 `agent-screenshots/`

用途：Agent 视觉工具截图输出目录。

## 11. Agent 运行机制（开发必读）

### 11.1 模式

- Normal：多步推理 + 工具循环 + 最终回答
- Direct：最多 0~1 次工具调用，快速返回

### 11.2 能力边界控制

- 每次请求允许指定 `allowedTools`
- `AgentService` 会进行白名单过滤
- 任何未授权工具调用会被拒绝

### 11.3 流式链路

- `app:agentChatStream` 建立一次请求
- 主进程向 `app:agentChatStream:event` 持续推送 `status/trace/content`
- 取消通过 `app:agentChatCancel`，内部 `AbortController` 中止

## 12. 配置与环境变量

### 12.1 环境变量（`.env`）

由 `src/main/config/env.js` 读取：

- `AI_MODEL`
- `AI_SUMMARY_MODEL`
- `AI_VISION_MODEL`
- `VISION_MODEL`
- `BASE_URL`
- `API_KEY`

### 12.2 关键常量

位于 `src/main/config/index.js`：

- 窗口模式与窗口映射
- 各业务 JSON 路径
- 触摸响应文案

## 13. 安全边界与工程约束

- `BrowserWindow` 默认 `nodeIntegration: false`
- `contextIsolation: true`
- Renderer 仅通过 `window.api` 调主进程
- 不允许在 Renderer 直接访问文件系统
- 所有持久化由主进程集中处理

## 14. 自动化基线

当前 `npm test` 执行 `scripts/auto-test.js`，包括：

- 关键入口文件存在性
- JSON 文件可解析性
- HTML 本地资源引用完整性
- IPC invoke/handle 一致性
- 遗留关键字清理
- 主进程 JS 语法检查

注意：当前无单元测试框架与 E2E 测试，属于后续应补齐的工程项。

## 15. 开发扩展指南

### 15.1 新增一个 IPC 能力（推荐流程）

1. 在 `ipcRegister.js` 增加业务方法（或先建领域模块）
2. 在 `ipcRegisterHandlers.js` 注册 `ipcMain.handle`
3. 在 `preload.js` 暴露 `window.api` 方法
4. 在 Renderer 页面调用并处理异常
5. 运行 `npm test` 验证契约一致性

### 15.2 新增一个 Agent 工具（推荐流程）

1. 在 `promptRegistry.js` 增加工具 spec（名称/参数/说明）
2. 在 `agentService.js` 路由到工具实现
3. 在对应 `agentSearchTools.js` 或 `agentVisionTools.js` 落地逻辑
4. 校验 `allowedTools` 过滤是否生效
5. 使用 `runAgentSelfTest` 做能力自测

### 15.3 新增一个持久化领域（推荐流程）

优先采用当前重构后的模式：

- 新建 `xxxStore.js` 负责“校验 + 读写 + 索引维护”
- `ipcRegister.js` 仅做聚合委托，不写大量领域细节
- handlers 只做契约映射

## 16. 当前已知工程风险

- `ipcRegister.js` 仍然偏大（记忆、卡片、QuickFloat 逻辑仍集中）
- 自动化测试覆盖深度不足（缺少单测/E2E）
- 抓取类工具依赖外部页面结构，存在稳定性风险
- 资源体积较大，打包优化空间明显

## 17. 建议的下一阶段重构顺序

1. 拆分 `memoryStore`（从 `ipcRegister.js` 抽离记忆域）
2. 拆分 `knowledgeCardStore`（统一卡片域校验与缓存更新）
3. 为 `pomodoroStore/clipboardStore` 补齐单元测试
4. 为关键 IPC 流程补回归测试（尤其 Agent 流式取消链路）
5. 建立文档与代码变更联动机制（每次架构改动同步本手册）

## 18. 交付前检查清单（建议放入 PR 模板）

- 新增 channel 是否同步了 `preload` 与 `handlers`
- 是否破坏 `npm test` 中的契约一致性检查
- 是否引入跨层访问（Renderer 直接操作 Node）
- 新增持久化是否具备 `ENOENT` 兜底与输入校验
- Agent 新工具是否可被 `allowedTools` 限制
- 文档是否同步更新（本手册 + 相关专题文档）

---

