# Live2dAssistant

一个基于 Electron Forge 的桌面助手应用，当前以 `devShell` 单壳窗口模式为主，围绕 Live2D 看板娘、聊天/Agent、知识卡片、番茄钟、日历计划、剪贴板管理和本地记忆系统持续迭代。

## 当前核心能力

- Live2D 看板娘交互与触摸反馈
- 普通对话 + Agent 对话（支持流式输出、取消、重试、执行轨迹）
- 知识卡片管理与摘要生成
- 番茄钟任务管理
- 日历计划、待办与 AI 日记
- 剪贴板快照与历史管理
- 短期上下文、长期记忆与每日自动提炼
- 模型提供商/模型参数本地配置

## 当前架构概览

项目采用 Electron 的主进程 / preload / renderer 分层：

- `src/main/main.js`：应用入口、Electron 存储路径初始化、后台维护任务启动
- `src/main/window/WindowManager.js`：窗口创建与 `devShell` 路由
- `src/main/preload.js`：通过 `window.api` 向渲染层暴露受控 IPC API
- `src/main/ipc/ipcRegister.js`：主进程聚合层，负责状态、持久化、Agent wiring、模型设置
- `src/main/ipc/ipcRegisterHandlers.js`：统一 IPC channel 注册
- `src/renderer/js/shell/app.js`：单壳导航与视图切换
- `src/renderer/js/*/index.js`：按功能拆分的前端模块

当前默认入口是 `src/renderer/view/index.html`，壳内视图包含：

- `assistant`
- `pomodoro`
- `cards`
- `calendar`
- `clipboard`
- `settings`

## 仓库结构

```text
src/
  main/
    main.js
    preload.js
    config/
    window/
    ipc/
  renderer/
    view/
    js/
    css/
    assets/
    vendor/
docs/
tests/
scripts/
```

### 主进程重点模块

- `src/main/ipc/agentService.js`：Agent 编排核心
- `src/main/ipc/aiService.js`：模型请求与流式解析
- `src/main/ipc/agentSearchTools.js`：搜索 / 网页 / 数据检索类工具
- `src/main/ipc/agentVisionTools.js`：截图 / 图像 / 剪贴板视觉工具
- `src/main/ipc/promptRegistry.js`：提示词与工具 spec
- `src/main/ipc/assistantPrompt.js`：普通对话与最终回答 prompt 组装
- `src/main/ipc/pomodoroStore.js` / `clipboardStore.js` / `calendarStore.js`：本地 JSON 持久化领域模块

### 渲染层重点模块

- `src/renderer/js/assistant/index.js`
- `src/renderer/js/cards/index.js`
- `src/renderer/js/pomodoro/index.js`
- `src/renderer/js/clipboard/index.js`
- `src/renderer/js/calendar/index.js`
- `src/renderer/js/settings/view.js`
- `src/renderer/js/shell/app.js`

## 开发命令

```bash
npm start
npm test
npm run test:auto
npm run test:unit
npm run lint:css
npm run lint:css:fix
npm run package
npm run make
```

说明：

- `npm test`：运行主检查脚本 `scripts/run-tests.js`
- `npm run test:auto`：运行自动化检查 `scripts/auto-test.js`
- `npm run test:unit`：运行单元测试 `scripts/run-unit-tests.js`

## 数据与本地持久化

主要业务数据保存在 Electron `userData` 目录下，核心文件由 `src/main/config/index.js` 定义：

- `assistant-context.json`
- `assistant-conversation-log.jsonl`
- `assistant-long-term-memory.json`
- `assistant-model-settings.json`
- `assistant-memory-routine.json`
- `knowledge-cards.json`
- `pomodoro.json`
- `clipboard-history.json`
- `calendar-plan.json`
- `agent-screenshots/`

## 文档索引

- `PROJECT_REQUIREMENTS_AND_ARCHITECTURE.md`：项目定位、产品目标、边界与当前维护重点
- `docs/DEVELOPER_ARCHITECTURE_GUIDE.md`：开发者架构手册，描述当前真实工程结构
- `docs/PROJECT_ARCHITECTURE_AND_STATUS_REPORT.md`：当前仓库状态与风险盘点
- `docs/CSS_STYLE_GUIDE.md`：CSS 分层与样式规范
- `docs/roadmap.md`：后续阶段路线与优先级

## credit

This content uses sample data owned and copyrighted by Live2D Inc. The sample data are utilized in accordance with terms and conditions set by Live2D Inc. This content itself is created at the author’s sole discretion.
