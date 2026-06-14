---
title: Designer Tutorial
description: Learn how to use Designer mode to create UI design projects, preview HTML or React frames, attach references, and record versions.
category: tutorial
order: 5
updatedAt: "2026-06-09 01:12:49 CEST"
tags:
  - designer
  - design
  - ui
---

# Designer Tutorial

Designer is a browser workspace for product and UI design work. It lets PMs, designers, and frontend designers create design projects, chat with an ACP agent, preview generated frames on a canvas, attach reference repositories, inspect selected elements, and record project versions.

Designer runs on the Specflow server, but it is separate from the workflow canvas. It does not start the Native Aflow agent conversation. Instead, it opens `/design` and lets each design session talk to the selected ACP agent from inside the Designer UI.

## Start Designer

Start the Specflow server:

```sh
specflow
```

Open the printed server URL with `/design` appended.
For example, if Specflow prints `http://127.0.0.1:3888`, open `http://127.0.0.1:3888/design`.

## Projects

Designer starts from a project list. A project is a folder under:

```text
.aflow/.specflow/design/projects/<project-name>/
```

Create a project, then enter it to start or resume design sessions.

Designer supports two project kinds:

- `HTML`: the default and recommended mode for pure design exploration. The agent creates static HTML, CSS, JavaScript, Markdown descriptions, and a `manifest.json`.
- `React`: a Vite React project managed by Aflow. Use it mainly when you already have a frontend framework project as reference and want the agent to design with similar component and style structure.

HTML projects do not require Node. React projects require Node `^20.19.0 || >=22.12.0`; Aflow checks this before creating or starting the React runtime. React projects use `npm` by default, and Aflow automatically chooses and manages the preview port.

## Frames And Manifest

The canvas renders frames from `manifest.json`.

In an HTML project, each frame points to root-level files:

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

In a React project, each frame points to a route:

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

`width` and `height` are the preview viewport size for the frame. `x` and `y` place the frame on the Designer canvas. `descriptionPath` points to the Markdown description for that frame.

HTML projects can also infer root-level `.html` files when no manifest exists, but maintaining `manifest.json` gives the canvas stable frame names, sizes, positions, and descriptions.

## Canvas Preview

The center canvas supports:

- High-fidelity HTML preview.
- Wireframe view using the same frame structure.
- Zoom, pan, and frame positioning.
- Element hover and selection inside each frame.
- Refreshing frames after agent file changes.

HTML frames are served by the Specflow server from the project folder. React frames are loaded from the Aflow-managed Vite dev server.

## Element Selection

Designer injects a small bridge into preview frames. The bridge lets the parent UI know which rendered element is hovered or selected.

There are two levels of selectable targets:

- `data-component-id`: stable semantic anchors authored in the design files. Use these for major regions and components.
- Auto-detected DOM elements: precise nested rendered elements used when the user clicks deeper inside a frame.

The right panel shows properties and hierarchy for the current selection. You can add the selected element, comments, or visual change drafts to the chat input as chips. When sent, those chips expand into structured prompt context so the agent can find the relevant element in the project files.

## Chat Sessions

Each project has its own design session history. Starting a new session lets you choose the agent, mode, model, and reasoning settings supported by that agent.

Designer sends an initial private setup prompt to the agent so it understands the project kind, file rules, frame manifest rules, wireframe requirements, description files, and how to work inside the project directory. The visible conversation starts with your own design message.

The chat input supports:

- Text prompts.
- Image attachments pasted into the input.
- Optional reference chips.
- Selected element chips.
- Element comment chips.
- Visual change draft chips.

Press `Enter` to send and `Shift+Enter` for a new line.

## References

Designer can import reference repositories into:

```text
.aflow/.specflow/design/references/<reference-name>/
```

References can be imported from Git or copied from a local folder. Large generated folders such as dependency and build outputs are ignored during local copy import.

When composing a message, expand the reference picker above the input, choose a reference, optionally describe which interface in that repository you want the agent to look at, and add it as a chip. The reference is attached to that message only.

For HTML projects, references provide visual and structure context. For React projects, the prompt also tells the agent to prefer the reference's component decomposition, naming style, design tokens, layout patterns, and interaction style when relevant, without copying code wholesale.

## Versions

Each Designer project can keep its own local Git history. Use the `Versions` button in the project header.

Version control requires `git` on the current machine. The first version initializes a Git repository inside the project folder. Later versions commit current project files with a UTC timestamp code and an optional note:

```text
version: 2026-06-07T15:30:12.421Z [checkout desktop draft]
```

The version dialog shows the commit graph. Selecting an older commit lets you continue from that version; if needed, Designer creates a new branch from that commit so the old version remains traceable.

## Files

Designer uses these workspace paths:

```text
.aflow/.specflow/design/
  projects/
  references/
  conversations/
  settings.json
```

Project files are the actual design artifacts. For HTML projects, this usually means `.html`, `.css`, `.js`, `.md`, and `manifest.json`. For React projects, this includes the Vite project files, `src/`, `.aflow-design/project.json`, Markdown descriptions, and `manifest.json`.

Conversations store Designer session metadata and timeline history. References store imported repositories. `settings.json` stores local Designer settings such as version author defaults.

These design folders are local workspace data and are added to `.aflow/.specflow/.gitignore` by default.

## Recommended Workflow

1. Start Designer from `aflow`.
2. Create an HTML project unless you specifically need React structure.
3. Ask the agent for the first screen or flow.
4. Review frames on the canvas in high-fidelity and wireframe modes.
5. Click elements, add comments or visual change chips, and send follow-up requests.
6. Attach a reference only when it helps the current message.
7. Record a version before large direction changes.
