---
title: Designer 使用教程
description: 学习如何使用 Designer 模式创建 UI 设计项目、预览 HTML 或 React frame、附加 reference 并记录版本。
category: tutorial
order: 5
updatedAt: "2026-06-09 01:12:49 CEST"
tags:
  - designer
  - design
  - ui
---

# Designer 使用教程

Designer 是面向产品和 UI 设计工作的浏览器工作台。它让 PM、设计师和前端 Designer 可以创建设计项目、和 ACP agent 对话、在画布中预览生成的 frame、附加 reference 仓库、检查选中元素，并记录项目版本。

Designer 运行在 Specflow server 上，但它和 workflow 画布是两个入口。它不会启动 Native Aflow agent 对话，而是打开 `/design`，让每个 design session 在 Designer UI 内和所选 ACP agent 对话。

## 启动 Designer

无参数启动 Aflow：

```sh
aflow
```

在启动选择中选择 `Designer`。Aflow 会准备 workspace、启动 Specflow server，并尝试直接用默认浏览器打开 Designer URL。

如果 server 已经在运行，也可以打开打印出来的 server URL，并在后面加上 `/design`。

## Project

Designer 进入后首先显示 project 列表。每个 project 都是下面目录中的一个文件夹：

```text
.aflow/.specflow/design/projects/<project-name>/
```

创建 project 后进入它，就可以开始新的设计 session，或恢复已有 session。

Designer 支持两类 project：

- `HTML`：默认模式，也最适合纯设计探索。Agent 会创建静态 HTML、CSS、JavaScript、Markdown 说明和 `manifest.json`。
- `React`：由 Aflow 管理的 Vite React project。主要适合你已经有前端框架项目作为 reference，并希望 agent 按相近的组件和样式组织方式做设计。

HTML project 不要求 Node。React project 要求 Node `^20.19.0 || >=22.12.0`；Aflow 会在创建或启动 React runtime 前检查版本。React project 默认使用 `npm`，预览端口由 Aflow 自动选择和管理。

## Frame 和 manifest

画布通过 `manifest.json` 知道要显示哪些 frame。

HTML project 中，每个 frame 指向根目录下的文件：

```json
{
  "frames": [
    {
      "id": "desktop",
      "title": "Desktop",
      "kind": "desktop",
      "width": 1440,
      "height": 1024,
      "x": 0,
      "y": 0,
      "designPath": "desktop.html",
      "descriptionPath": "desktop.md"
    }
  ]
}
```

React project 中，每个 frame 指向一个 route：

```json
{
  "frames": [
    {
      "id": "dashboard",
      "title": "Dashboard",
      "kind": "desktop",
      "width": 1440,
      "height": 1024,
      "x": 0,
      "y": 0,
      "route": "/dashboard",
      "descriptionPath": "dashboard.md"
    }
  ]
}
```

`width` 和 `height` 是该 frame 在画布中的预览 viewport 尺寸。`x` 和 `y` 是该 frame 在画布上的位置。`descriptionPath` 指向该 frame 的 Markdown 设计说明。

HTML project 在没有 manifest 时可以根据根目录 `.html` 文件推断 frame，但维护 `manifest.json` 可以让画布稳定获得 frame 名称、尺寸、位置和说明。

## 画布预览

中间画布支持：

- 高保真 HTML 预览。
- 基于同一 frame 结构的线框图视图。
- 缩放、拖拽和平移画布。
- 在 frame 内悬浮和选择元素。
- Agent 修改文件后刷新 frame。

HTML frame 由 Specflow server 从 project 文件夹安全提供。React frame 从 Aflow 管理的 Vite dev server 加载。

## 元素选择

Designer 会向预览 frame 注入一个小型 bridge。这个 bridge 会把当前悬浮或选中的渲染元素告诉父级 UI。

可选中目标分两层：

- `data-component-id`：设计文件中显式写下的稳定语义锚点，适合主要区域和大组件。
- 自动识别的 DOM 元素：用户在 frame 中点到更细层级时使用的精确渲染元素。

右侧面板会显示当前选中元素的属性和层级。你可以把选中元素、评论或视觉修改草稿作为 chip 加入聊天输入框。发送时，这些 chip 会展开成结构化 prompt context，帮助 agent 在项目文件中定位对应元素。

## Chat session

每个 project 都有自己的设计 session 历史。创建新 session 时，可以选择 agent，以及该 agent 支持的 mode、model 和 reasoning 设置。

Designer 会先向 agent 发送一条私有初始化 prompt，让它理解 project 类型、文件规则、frame manifest 规则、线框图要求、说明文件，以及只能在当前 project 目录中工作。用户可见的对话从你自己的设计消息开始。

聊天输入框支持：

- 文本 prompt。
- 粘贴图片附件。
- 可选 reference chip。
- 选中元素 chip。
- 元素评论 chip。
- 视觉修改草稿 chip。

按 `Enter` 发送，按 `Shift+Enter` 换行。

## Reference

Designer 可以把 reference 仓库导入到：

```text
.aflow/.specflow/design/references/<reference-name>/
```

Reference 可以从 Git 导入，也可以从本地文件夹复制导入。本地复制时会忽略依赖、构建输出等大型生成目录。

编辑消息时，在输入框上方展开 reference 选择器，选择一个 reference，并可选填写希望 agent 参考该仓库里的哪个界面，然后把它加入为 chip。Reference 只会附加到这一次消息。

对 HTML project 来说，reference 提供视觉和结构上下文。对 React project 来说，prompt 还会要求 agent 在合适时优先参考 reference 的组件拆分、命名习惯、设计 token、布局模式和交互方式，但不要整段复制 reference 代码。

## 版本

每个 Designer project 都可以维护自己的本地 Git 历史。使用 project header 里的 `Versions` 按钮进入版本弹窗。

版本功能要求当前电脑有 `git`。第一次记录版本会在 project 文件夹里初始化 Git 仓库。之后每次记录版本，会用 UTC 时间戳和可选备注提交当前 project 文件：

```text
version: 2026-06-07T15:30:12.421Z [checkout desktop draft]
```

版本弹窗会显示 commit graph。选择一个旧 commit 后可以从那个版本继续开发；必要时 Designer 会从该 commit 创建新分支，旧版本仍可追踪。

## 文件位置

Designer 使用这些 workspace 路径：

```text
.aflow/.specflow/design/
  projects/
  references/
  conversations/
  settings.json
```

Project 文件是真正的设计产物。HTML project 通常包含 `.html`、`.css`、`.js`、`.md` 和 `manifest.json`。React project 会包含 Vite project 文件、`src/`、`.aflow-design/project.json`、Markdown 说明和 `manifest.json`。

Conversations 保存 Designer session 元信息和 timeline 历史。References 保存导入的 reference 仓库。`settings.json` 保存本地 Designer 设置，例如版本作者默认值。

这些 design 目录属于本地 workspace 数据，默认会加入 `.aflow/.specflow/.gitignore`。

## 推荐流程

1. 从 `aflow` 启动 Designer。
2. 除非明确需要 React 结构，否则优先创建 HTML project。
3. 让 agent 先生成第一个页面或流程。
4. 在画布中检查高保真和线框图视图。
5. 点击元素，加入评论或视觉修改 chip，再发送后续要求。
6. 只在当前消息确实需要参考时附加 reference。
7. 在大方向调整前记录一个版本。
