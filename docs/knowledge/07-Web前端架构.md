# 07 · Web 前端架构

> 前端位于 `web/`，是**运行在 ComfyUI 内部的纯原生 JavaScript（ES Modules）应用，无打包、无构建步骤**，由 ComfyUI 静态资源服务器按文件直接提供。

## 1. 技术栈与加载方式

- **原生 ES Modules**：`import`/`export`，直接由 ComfyUI Web 服务器原样提供，无打包器/转译器。
- **宿主依赖**：深度依赖 ComfyUI 全局 `app`（`../../scripts/app.js`）与 `api`（`../../scripts/api.js`）。
- **入口**：`web/freevideo.js` 是唯一静态导入入口，调用 `app.registerExtension(...)` 注册扩展；重模块（autopilot、editor、library、whitebox）用动态 `import()` 懒加载，避免拖慢首屏。
- **样式**：CSS 不在 JS 内联，而是运行时用 `document.createElement('link')` + `new URL('./x.css', import.meta.url)` 注入。`web/theme.css` 是唯一设计系统文件（`--fv-*` 变量，作用域化，不改 ComfyUI 主题），其余每个工作区自带 `.css`。
- **健壮性自检**：`health.js` 维护约 135 个 JS 文件清单，检测脚本是否完整加载，失败给出具体文件名与修复建议。

## 2. 视图导航与四大工作区

```mermaid
flowchart LR
    REG[freevideo.js 注册扩展] --> NAV[view_navigation.js<br/>viewSwitch()]
    NAV -->|按钮| S[创作面板 Studio]
    NAV -->|按钮| N[节点视图 Nodes]
    NAV -->|按钮| E[剪辑视图 Editor]
    NAV -->|按钮| A[AI 全自动 Autopilot]
    S --> SL[studio.js + studio_*.js]
    E --> EL[editor_loader → editor.js + editor_*.js]
    A --> AL[autopilot.js + agent_*.js]
```

`view_navigation.js` 提供四个视图按钮（创作 / 节点 / 剪辑 / AI 全自动），并向 `document.body` 注入可拖拽侧边工具栏 `.fv-view-navigation`（设置、局域网访问、版本、反馈入口）。各工作区以 `<dialog>` 浮层呈现。

| 工作区 | 入口模块 | 说明 |
|---|---|---|
| 创作面板 Studio | `studio.js` | 文/图/参考→视频主创作台：提示词、`studio_chain`（长视频切≤8段）、`studio_extend`（续接）、`studio_length/size`、`studio_queue`（队列/种子）、`sampling_effort`（画质档）、`prompt_*`、`lora_*` |
| 节点视图 | ComfyUI 画布 + 节点 DOM 控件 | `FreeVideoGenerate` 节点内嵌“素材面板”与“结果/进度面板”两个 `addDOMWidget` |
| 剪辑视图 Editor | `editor_loader.js` → `editor.js` | 时间线：轨道、片段、播放头、播放器、文字、音频、变速、调节、导出 |
| AI 全自动 Autopilot | `autopilot.js` | 连接外部 Agent 对话驱动生成；连接卡片 + 会话界面 |
| 素材库 Library | `library.js` | 输出视频库，批量“撤销删除”（服务端权威 + localStorage 待撤销队列） |
| 分享 / 设置 / 局域网 | `share.js` / `setup.js` / `lan_access.js` | 分享卡 Canvas 绘制；安装目录/质量/测速/更新；手机/局域网二维码 |

## 3. 状态管理

- **去中心化**：无 Redux/Vuex。大量状态直接挂在 ComfyUI 节点对象上（`node.freevideoShowProgress` 等），由 `freevideo.js` 充当“面板⇄节点”桥。
- **跨模块事件总线**：`window` 上的 `CustomEvent`（`freevideo-media`、`freevideo-result`、`freevideo-progress`、`freevideo-library-undo` 等）。
- **编辑器状态**：`editor_state.js` 的 `createEditorState` 是有界撤销/重做历史（默认 200 步，`Object.freeze` 不可变 + 监听器发布订阅）；`editor_model.js` 解析/校验记录；`editor_store.js` 做防抖+串行写入 + `navigator.locks` 跨标签页会话锁 + localStorage outbox 断网兜底。
- **Agent 会话**：`chat_data.js` 用 `Map` 存消息与任务，前端轮询而非长连接。

## 4. 后端通信

- **实时进度**：`progress_connection.js` 同时消费 ComfyUI WebSocket 事件 `freevideo_progress` 与每 2 秒轮询 `GET /freevideo/progress`（快照恢复）。
- **生成请求**：走 ComfyUI 标准队列（`app.graphToPrompt()` → 队列），结果经 WebSocket 回传。
- **REST 端点族**（`/freevideo/*`，见 `06`）：`/chain`、`/editor/*`、`/library`、`/share`、`/updates`、`/lan`、`/media/upload`（2GiB 上限流式）、`/image-gen/*`、`/agent`、`/agent/v1/*`（Agent 专用，见 `10`）。
- **媒体查看**：统一用 `api.apiURL('/view?...')` 取 input/output 下的图片/视频/音频。

## 5. 从文件结构看出的关键功能

- **视频生成 H3**：`studio*`、`generation_progress.js`、`result_actions.js`（二采/重跑）、`sampling_effort.js`。
- **时间线剪辑**：`editor_*.js` 一族（轨道/选择/播放/文字/音频/变速/调节/关键帧/导出/库）。
- **AI Agent / Autopilot**：`agent_connect.js`、`autopilot*.js`、`chat_data.js`、`agent_activity.js`。
- **白盒 / 占位场景预览**：`whitebox_*.js`（轮询 `/agent/whitebox/next`，在沙箱渲染“白模场景”再 `MediaRecorder` 录制成 MP4——用于简单占位场景预览，并非一般屏幕捕获）。
- **图像生成与图层编辑**：`image_generation.js`、`image_editor*.js`（图层文档存为 `.edit.json`）。
- **角色 Cast**：`cast_*.js`（提示词 `@角色名` 展开为 `<Subject N>` + 定义）。
- **LoRA / 分享 / 安装更新 / 健康报错**：`lora_*`、`share*`、`setup*`、`health.js` / `error_panel.js` / `report_issue.js`。

## 6. 设计要点

- **零构建**降低维护与分发成本，但要求严格文件命名与运行时 CSS 注入。
- **ComfyUI 扩展形态**：所有 UI 叠加在节点视图之上，复用其 WebSocket 与队列，避免自建传输层。
- **状态局部化 + 事件总线**：适合中等规模插件，但跨模块依赖靠约定（`CustomEvent` 名、节点字段名），需 `health.js` 兜底防缺文件。
