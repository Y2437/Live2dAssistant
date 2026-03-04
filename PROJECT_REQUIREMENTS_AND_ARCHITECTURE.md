# Live2dAssistant 项目需求与架构说明

## 1. 文档目的

这份文档用于描述 `Live2dAssistant` 当前版本的真实产品目标、代码结构、数据设计、Agent 能力边界，以及后续迭代方向。

适用场景：
- 新成员快速理解项目
- 继续迭代大窗口模式和 Agent 能力
- 对齐“已经实现”和“计划实现”的边界
- 为后续重构、测试和补全文档提供基线

## 2. 项目定位

`Live2dAssistant` 是一个基于 Electron 的桌面助手项目。它的目标不是单纯展示 Live2D 模型，而是围绕以下三条主线构建长期可迭代的桌面 Agent：

1. 看板娘交互
2. 本地资料与记忆管理
3. 可调用工具的 Agent 工作流

当前优先方向明确是“大窗口模式”。分窗口页面保留基础入口，但不是当前主迭代目标。

## 3. 当前产品目标

### 3.1 大窗口模式

大窗口模式是当前主界面。

目标体验：
- 左侧为 Live2D 看板娘区域
- 默认通过上方浮动气泡显示短回复和触摸反馈
- 当回复较长或 Agent 轨迹较多时，自动切换为左右分栏
- 左侧继续保留 Live2D 画布
- 右侧显示类似聊天面板的长对话区

当前状态：
- 已实现大窗口布局切换
- 已实现长回复自动展开
- 已实现右侧聊天面板基础版
- 已实现触摸反馈浮窗
- 已修正展开后 Live2D 与浮窗居中偏移问题

当前限制：
- 当前仍是伪流式输出，不是真正的模型流式返回
- Agent 行为展示目前仍以 trace 文本为主，不是完整结构化任务面板

### 3.2 资料管理器

资料管理器的定位是“本地文件只读托管与检索界面”，不承担编辑职责。

目标要求：
- 托管本地文件并展示
- 按分类显示列表
- 提供目录树
- 支持 Markdown 预览和大纲
- 支持代码文件高亮预览
- 支持 PDF 预览
- 启动时比对已有索引，按新增或变更做增量更新
- 为 Agent 提供检索与读取能力

当前状态：
- 已实现只读资料管理器界面
- 已实现分类列表
- 已实现目录树
- 已实现 Markdown 预览和大纲
- 已实现代码高亮预览
- 已实现 PDF 预览
- 已实现本地资料索引增量更新
- 已接入 Agent 检索链路

当前限制：
- PDF 目前只有预览，没有正文抽取和正文索引
- 当前检索是“文件名 + 摘要 + chunk 关键词召回”，不是向量语义 RAG

### 3.3 知识卡片箱

知识卡片箱的定位是结构化知识沉淀容器。

目标要求：
- 以 JSON 持久化卡片
- 支持列表展示
- 展示标题与摘要
- 支持用户创建
- 支持 Agent 创建
- 支持查看详情
- 支持搜索

当前状态：
- 已支持新建、更新、删除
- 已支持摘要生成
- 已修复摘要持久化
- 已修复 Agent 创建卡片时缺少摘要的问题
- 预览已直接复用 `marked`

当前限制：
- 未保存离开保护还不完整
- 缩略图化卡片视觉还可以继续优化
- Agent 工作流展示仍比较基础

### 3.4 AI 记忆系统

记忆系统分为短期上下文和长期记忆两层。

目标要求：
- 聊天上下文本地持久化
- 定时或按日期提炼长期记忆
- 提取稳定偏好、事实和长期任务
- 支持记忆查看和后续管理

当前状态：
- 已持久化短期上下文
- 已持久化长期记忆
- 已支持长期记忆分类、标签、置信度、状态字段
- 已支持手动提炼
- 已支持删除
- 已支持每日自动提炼雏形

当前限制：
- 去重和污染控制还可以继续加强
- 目前不是完整的语义记忆检索系统
- 记忆管理界面仍是基础版

### 3.5 Agent 能力

Agent 当前已经接入主进程工具链，但不同工具的成熟度并不一致。

目标方向：
- 能搜索网络信息
- 能查本地资料库
- 能查看和提炼记忆
- 能管理知识卡片
- 能读剪贴板和截图
- 能读取图片
- 能读取番茄钟状态

当前状态：
- 已接入基础工具链
- 已加入安全的能力自测流程
- 已加入预判式前置工具调用
- 已加入每日记忆维护和资料索引维护

当前限制：
- 工具调度仍偏规则驱动
- 不是成熟的多步任务规划器
- 一部分工具只做到“可调用”，还没做到“深度完成”

## 4. 当前 Agent 真实能力边界

这部分不是目标描述，而是当前代码里的真实能力说明。

### 4.1 上下文与记忆

- `get_context`
  - 返回最近短期上下文
- `get_memory`
  - 返回长期记忆列表
- `search_memory`
  - 基于关键词匹配记忆字段
  - 不是语义召回
- `get_memory_routine_status`
  - 返回每日自动记忆任务状态
- `add_memory`
  - 新增长期记忆
- `delete_memory`
  - 删除长期记忆
- `extract_memory`
  - 基于近期上下文提炼长期记忆

### 4.2 知识卡片

- `list_cards`
  - 返回知识卡片列表
- `search_cards`
  - 基于标题、分类、内容做关键词搜索
- `get_card`
  - 读取单张卡片完整内容
- `create_card`
  - 新建知识卡片

### 4.3 资料库

- `get_library_overview`
  - 返回资料索引概览
- `search_library`
  - 基于文件名、摘要和 chunk 做关键词召回
  - 当前不是向量检索
- `read_library_file`
  - 支持文本、Markdown、代码文件读取
  - PDF 当前只返回预览模式信息，不返回正文文本

### 4.4 系统与辅助工具

- `get_pomodoro_status`
  - 返回番茄钟状态
- `get_clipboard`
  - 返回剪贴板文本和基础状态
- `analyze_clipboard_image`
  - 分析剪贴板图片
- `capture_screen`
  - 进行截图
- `list_screenshots`
  - 返回截图历史
- `analyze_image`
  - 分析指定图片

### 4.5 联网搜索

- `web_search`
  - 当前主要返回搜索结果标题和链接
  - 不会自动深读搜索结果页面正文
  - 当前更接近“搜索入口发现器”，不是完整网页阅读器

## 5. 当前代码架构

项目使用 Electron 主进程 / 渲染进程分层。

### 5.1 主进程目录

`src/main`

当前结构：
- `main.js`
- `preload.js`
- `config/`
- `window/`
- `ipc/`

职责：
- Electron 生命周期
- 窗口管理
- IPC 注册
- 本地 JSON 持久化
- Agent 工具调度

### 5.2 渲染进程目录

`src/renderer`

当前结构：
- `view/`
- `js/`
- `css/`
- `vendor/`

职责：
- 页面布局
- 交互逻辑
- Live2D 渲染
- 资料、卡片、设置、番茄钟界面

## 6. 主进程架构

### 6.1 入口

[src/main/main.js](/E:/WebStrom/Live2dAssistant/src/main/main.js)

职责：
- 启动 Electron
- 初始化 IPC
- 打开主窗口
- 启动后台维护任务

### 6.2 配置层

[src/main/config/index.js](/E:/WebStrom/Live2dAssistant/src/main/config/index.js)
[src/main/config/env.js](/E:/WebStrom/Live2dAssistant/src/main/config/env.js)

职责：
- 统一管理主进程常量
- 统一收口环境变量
- 统一窗口页面路径、数据文件路径、模型配置

当前说明：
- 各模块不再直接散读 `process.env`
- 统一通过 `ENV_CONFIG` 读取环境变量

### 6.3 窗口层

[src/main/window/WindowManager.js](/E:/WebStrom/Live2dAssistant/src/main/window/WindowManager.js)

职责：
- 管理窗口定义
- 打开、关闭、切换窗口
- 在 `devShell` 模式下做统一视图承载

### 6.4 IPC 状态中心

[src/main/ipc/ipcRegister.js](/E:/WebStrom/Live2dAssistant/src/main/ipc/ipcRegister.js)

职责：
- 管理上下文、记忆、知识卡片等本地状态
- 加载和持久化 JSON 数据
- 驱动 Agent 生命周期
- 协调每日记忆提炼和其他维护流程

### 6.5 IPC 注册层

[src/main/ipc/ipcRegisterHandlers.js](/E:/WebStrom/Live2dAssistant/src/main/ipc/ipcRegisterHandlers.js)

职责：
- 注册窗口、聊天、记忆、Agent、番茄钟、知识卡片等 IPC handler
- 将注册逻辑从 `ipcRegister` 本体中拆出

### 6.6 Agent 编排层

[src/main/ipc/agentService.js](/E:/WebStrom/Live2dAssistant/src/main/ipc/agentService.js)

职责：
- Agent 主对话循环
- 工具调用编排
- 前置工具预判
- traces 组织
- 自测流程

### 6.7 Agent 工具模块

[src/main/ipc/agentLibraryTools.js](/E:/WebStrom/Live2dAssistant/src/main/ipc/agentLibraryTools.js)
[src/main/ipc/agentSearchTools.js](/E:/WebStrom/Live2dAssistant/src/main/ipc/agentSearchTools.js)
[src/main/ipc/agentVisionTools.js](/E:/WebStrom/Live2dAssistant/src/main/ipc/agentVisionTools.js)
[src/main/ipc/agentShared.js](/E:/WebStrom/Live2dAssistant/src/main/ipc/agentShared.js)

职责：
- 拆分资料库、搜索、视觉、共享工具逻辑
- 让 `agentService` 保持编排角色，而不是继续堆积底层实现

### 6.8 AI 请求层

[src/main/ipc/aiService.js](/E:/WebStrom/Live2dAssistant/src/main/ipc/aiService.js)

职责：
- 统一向模型发起请求
- 区分主模型、摘要模型、视觉模型
- 统一错误包装

### 6.9 数据工具层

[src/main/ipc/ipcDataUtils.js](/E:/WebStrom/Live2dAssistant/src/main/ipc/ipcDataUtils.js)

职责：
- 记忆与卡片数据归一化
- 摘要、分类、去重辅助逻辑

## 7. 渲染进程架构

### 7.1 目录组织

当前 `src/renderer/js` 已按功能拆分：
- `core`
- `shell`
- `assistant`
- `cards`
- `organizer`
- `pomodoro`
- `settings`
- `shared`

### 7.2 配置中心

[src/renderer/js/core/config.js](/E:/WebStrom/Live2dAssistant/src/renderer/js/core/config.js)

职责：
- 统一收口渲染层配置
- 管理默认视图、Live2D 参数、Assistant 文案、分类标签等配置项

### 7.3 Shell

[src/renderer/js/shell/app.js](/E:/WebStrom/Live2dAssistant/src/renderer/js/shell/app.js)

职责：
- 管理主窗口视图切换
- 承接设置页渲染与导航协同

### 7.4 Assistant

[src/renderer/js/assistant/index.js](/E:/WebStrom/Live2dAssistant/src/renderer/js/assistant/index.js)

职责：
- 初始化 Live2D
- 摆放模型
- 渲染触摸气泡
- 渲染聊天记录
- 处理大窗口展开与收起

### 7.5 Cards

[src/renderer/js/cards/index.js](/E:/WebStrom/Live2dAssistant/src/renderer/js/cards/index.js)
[src/renderer/js/cards/markdown.js](/E:/WebStrom/Live2dAssistant/src/renderer/js/cards/markdown.js)

职责：
- 知识卡片列表、详情、编辑
- Markdown 预览辅助

说明：
- 卡片 Markdown 预览已回归 `marked`
- 不再单独维护一套自写 Markdown 解析器

### 7.6 Organizer

[src/renderer/js/organizer/index.js](/E:/WebStrom/Live2dAssistant/src/renderer/js/organizer/index.js)
[src/renderer/js/organizer/utils.js](/E:/WebStrom/Live2dAssistant/src/renderer/js/organizer/utils.js)

职责：
- 资料管理器视图与事件
- 分类、目录树、Markdown 大纲、预览渲染

### 7.7 Settings

[src/renderer/js/settings/view.js](/E:/WebStrom/Live2dAssistant/src/renderer/js/settings/view.js)

职责：
- 设置页视图拼装

### 7.8 Shared

[src/renderer/js/shared/dom.js](/E:/WebStrom/Live2dAssistant/src/renderer/js/shared/dom.js)

职责：
- 公共 DOM 工具

## 8. 数据持久化设计

当前主要使用本地 JSON 文件持久化。

### 8.1 上下文

- 文件：`AI_CONTEXT_JSON_PATH`
- 内容：用户和助手的最近对话

### 8.2 长期记忆

- 文件：`AI_LONG_TERM_MEMORY_JSON_PATH`
- 典型字段：
  - `id`
  - `title`
  - `content`
  - `category`
  - `tags`
  - `confidence`
  - `status`
  - `source`
  - `fingerprint`

### 8.3 知识卡片

- 文件：`KNOWLEDGE_CARDS_JSON_PATH`
- 典型字段：
  - `id`
  - `title`
  - `content`
  - `summary`
  - `category`
  - `source`
  - `createdAt`
  - `updatedAt`

### 8.4 记忆任务状态

- 文件：`AI_MEMORY_ROUTINE_JSON_PATH`
- 内容：
  - 上次执行日期
  - 上次运行时间
  - 状态
  - 新增数量
  - 跳过数量
  - 错误信息

### 8.5 资料库索引

- 文件：`AGENT_LIBRARY_INDEX_JSON_PATH`
- 维护者：`AgentService`
- 当前内容：
  - 文件元数据
  - 相对路径
  - 分类
  - 摘要
  - chunk 信息
  - 索引统计

## 9. 资料索引设计

当前方案是“增量索引 + chunk 关键词召回”。

流程：
1. 扫描托管目录
2. 根据路径、大小、修改时间生成签名
3. 未变化文件复用旧索引
4. 新增或变更文件重建摘要与 chunk
5. 写回索引

当前优点：
- 启动时不需要每次全量重建
- 能支撑前端搜索和 Agent 粗粒度召回

当前不足：
- PDF 没有正文抽取
- 没有 embedding
- 没有语义重排

## 10. 已完成的关键成果

### 10.1 架构层

- 主进程已完成一轮模块化拆分
- 渲染进程已完成一轮目录归档
- 前后端配置项都开始集中管理

### 10.2 功能层

- 大窗口模式主交互链可用
- Agent 工具链主路径可用
- 资料管理器只读链路可用
- 记忆系统基础链路可用
- 知识卡片基础链路可用

### 10.3 稳定性层

- 已修复多处持久化问题
- 已修复模块拆分后多处断链问题
- 已修复窗口路径错误与若干布局问题

## 11. 当前未完成项

### 11.1 高优先级

- 真正的模型流式输出
- PDF 正文抽取与索引
- 更强的本地语义 RAG
- 更稳定的 Agent 多步规划

### 11.2 中优先级

- 记忆管理界面增强
- 知识卡片未保存保护
- 剪贴板管理器正式界面
- 更结构化的 Agent 轨迹展示

### 11.3 低优先级

- 分窗口正式功能页
- 更细的视觉动画
- 自动化测试体系

## 12. 建议的后续迭代顺序

建议按以下顺序推进：

1. 真流式输出链路
2. PDF 正文抽取与资料索引增强
3. 本地语义 RAG
4. Agent 结构化执行面板
5. 记忆系统去重、分类、污染控制继续增强
6. 知识卡片与资料管理器交互细化

## 13. 当前代码维护原则

### 13.1 大窗口优先

所有主体验优先围绕大窗口模式迭代。

### 13.2 资料库只读

资料管理器只负责托管、查看、检索、预览，不承担编辑职责。

### 13.3 配置集中化

前后端配置优先收口，不再散落到业务代码各处。

### 13.4 主进程职责拆分

- `ipcRegister` 负责状态与生命周期
- `ipcRegisterHandlers` 负责 IPC 注册
- `agentService` 负责 Agent 编排
- `agent*Tools` 负责具体工具域

### 13.5 Renderer 分层

- `core` 放配置
- `shared` 放公共工具
- 页面逻辑按功能目录拆分

## 14. 文档维护建议

后续在以下情况应同步更新本文档：
- Agent 工具能力边界有变化
- 资料索引方案有变化
- 记忆系统策略有变化
- Renderer 或主进程再次大规模重构

如果后续要继续规范化，建议再补三份专项文档：
- `docs/agent-design.md`
- `docs/data-models.md`
- `docs/renderer-structure.md`
