(() => {
  "use strict";

  const STORAGE_KEY = "aflow.locale";
  const THEME_STORAGE_KEY = "aflow.theme";
  const LOCALES = ["zh-CN", "en-US"];
  const THEMES = ["light", "dark"];
  const RELEASES_URL = "https://github.com/DuGuYifei/Aflow/releases";
  const DOCS_LOCALE = { "zh-CN": "zh", "en-US": "en" };
  const page = document.body.dataset.page || "home";
  const docsState = {
    manifest: null,
    manifestLoading: false,
    loadingKey: "",
    currentKey: "",
    currentDoc: null,
    html: "",
    headings: [],
    error: "",
  };
  let revealObserver = null;

  const copy = {
    "zh-CN": {
      meta: {
        homeTitle: "Aflow - Agent, Specflow, Designer",
        homeDescription: "Aflow 将 Agent 工作流、Aflow Specflow runtime 和产品设计工作台放进同一个本地系统。",
        downloadTitle: "下载 Aflow",
        downloadDescription: "从 GitHub Releases 下载 Aflow 二进制文件，或使用 README 中的安装命令。",
        docsTitle: "Aflow 文档",
        docsDescription: "阅读 Aflow Agent、Aflow Specflow 与 Aflow Designer 的教程、命令和 workspace 文档。",
        productsTitle: "Aflow 产品",
        productsDescription: "了解 Aflow Agent、Aflow Specflow 与 Aflow Designer：工作流 Agent、runtime 基础层和产品设计工作台。",
        siteName: "Aflow",
      },
      accessibility: {
        primaryNavigation: "主导航",
        languageSelector: "选择语言",
        themeSelector: "选择主题",
        skipToContent: "跳到主要内容",
        mobileMenuOpen: "打开导航菜单",
        mobileMenuClose: "关闭导航菜单",
        previewSummary: "Aflow 产品星图，展示 Aflow Agent、Aflow Specflow、Aflow Designer、References 和 Versions 节点。",
      },
      navigation: {
        product: "产品",
        aflowSoon: "工作流 Agent",
        specflow: "Runtime foundation",
        designer: "产品设计工作台",
        useCases: "场景",
        technical: "技术",
        docs: "文档",
        download: "下载",
        github: "GitHub",
        primaryCta: "下载",
      },
      hero: {
        badge: "Design workspace + Agent workflows",
        titleRows: [
          { kind: "kicker", text: "从" },
          { kind: "statement", text: "工作流前" },
          { kind: "kicker", text: "到" },
          { kind: "statement", text: "工作流后" },
        ],
        body: "Aflow Agent 构建在 Specflow 之上。它不是又一个聊天窗口，而是一个靠工作流生存的 Agent：帮助团队设计、运行、维护并优化那些稳定而复杂的业务流程。流程给它骨架，反馈给它记忆，行业 Agent 给它真正的判断力。",
        primaryCta: "下载 Aflow",
        secondaryCta: "查看产品",
        supportLine: "Aflow Agent · Aflow Specflow · Aflow Designer",
        monoLabel: "Before: scattered agent work. After: workflow-native design, runtime, and execution.",
      },
      preview: {
        eyebrow: "product workspace",
        title: "Design, workflow, runtime",
        startRun: "preview loop",
        caption: "Aflow Agent、Aflow Specflow 和 Aflow Designer 组成同一个本地工作台：从 Agentic Workflow 的执行，到 runtime 轨迹，再到产品设计产物。",
        nodes: [
          ["A1", "Aflow Agent", "workflow planning", "done"],
          ["S1", "Aflow Specflow", "runtime + logs", "running"],
          ["D1", "Aflow Designer", "HTML / React frames", "ready"],
          ["R1", "References", "repo + interface notes", "waiting"],
          ["V1", "Versions", "artifact history", "queued"],
        ],
        trace: ["workflow captured", "runtime trace recorded", "design frame versioned"],
      },
      workflowPhases: {
        label: "工作流前 / 中 / 后",
        title: "工作流前、中、后分别解决不同问题。",
        body: "Aflow 不是把所有事情塞进一个按钮。它把 Agentic Workflow 拆成三个自然阶段：先形成设计和输入，再编排运行，最后回到真实 agent session 里继续打磨结果。",
        items: [
          {
            step: "前",
            title: "工作流前：设计和准备",
            product: "Aflow Designer",
            body: "用 reference、HTML/React frame、线框图、元素评论和版本记录，把 PM 或前端 Designer 的想法变成可预览的界面产物。",
          },
          {
            step: "中",
            title: "工作流中：编排和运行",
            product: "Aflow Agent + Aflow Specflow",
            body: "把任务拆进节点、session、human gate 和 run log。Agent 不再只是在聊天里自由发挥，而是在可审查的 workflow 中协作。",
          },
          {
            step: "后",
            title: "工作流后：恢复和手动优化",
            product: "Native agent session",
            body: "运行结束后，可以 resume 到原生 agent 的 session 里继续工作，手动优化结果、补充判断，并把上下文带回后续流程。",
          },
        ],
      },
      values: [
        {
          label: "01",
          title: "Aflow Agent 把复杂任务变成可运行的工作流。",
          body: "需求、设计、实现、审查和返工不再揉成一段长对话，而是进入可视节点、human gate、跨 session 上下文和可复用 workflow-as-code。",
        },
        {
          label: "02",
          title: "Aflow Specflow 保持底层运行可审查、可恢复。",
          body: "Agent server、ACP session、run log、artifact、版本和 workflow 文件都有明确位置，让团队能复盘运行，也能从旧状态继续推进。",
        },
        {
          label: "03",
          title: "Aflow Designer 给非工程角色一个真正可用的设计入口。",
          body: "PM 和前端 Designer 可以创建 HTML 或 React project，在画布中查看多 frame 设计稿、线框图、元素层级、局部评论和 reference 上下文。",
        },
      ],
      useCases: {
        label: "Use cases",
        title: "从设计稿到 Agent 流程，Aflow 让产物和过程都能继续生长。",
        body: "同一套 workspace 可以承载产品设计、软件交付和业务 Agent 编排。设计师看到画布，工程团队看到 workflow，团队看到可追踪的过程。",
        items: [
          {
            title: "Product Design / 产品设计",
            flow: "Reference -> Prompt -> HTML/React Frames -> Wireframe -> Comment -> Version",
            body: "Designer 让产品想法直接变成可预览的多 frame 设计稿。用户可以选择 reference、点击元素提修改、记录版本，再把结果交给后续实现流程。",
            stats: ["HTML/React project", "wireframe mode", "version history"],
          },
          {
            title: "Software Delivery / 代码交付",
            flow: "Requirement -> Spec -> Plan -> Code -> Test -> Review",
            body: "需求澄清、spec、实现、测试、审查与返工路径都在同一张图里。Code Agent 可以强，但流程要可复盘。",
            stats: ["spec generated", "tests passed", "review approved"],
          },
          {
            title: "Agent Operations / 业务 Agent 编排",
            flow: "Intake -> Specialist Agent -> Gate -> Rework -> Deliver -> Resume",
            body: "不同团队可以把行业 Agent 接进同一张可运行图。Aflow 负责流程顺序、人工判断、上下文交接和恢复入口。",
            stats: ["persistent sessions", "human gates", "run traces"],
          },
        ],
      },
      technical: {
        label: "Built on Aflow Specflow",
        title: "三种入口，共用同一个本地运行底座。",
        body: "Aflow Agent 面向工作流创建和运行；Aflow Specflow 面向可视化 workflow、run log 和 session 恢复；Aflow Designer 面向产品界面设计。它们共享 agent 配置、ACP 连接、workspace 文件和可追踪运行记录。",
        tags: ["Aflow Agent", "Aflow Specflow runtime", "Aflow Designer projects", "ACP timeline", "Local versioning"],
        command: ["$ aflow", "1. Aflow Agent", "2. Aflow Specflow", "3. Aflow Designer"],
      },
      closing: {
        title: "让设计稿、工作流和 Agent 记忆都留下形状。",
        body: "产品设计不再只是一次对话截图，Agent 协作也不再藏在临时 prompt 里。Aflow 把它们放回文件、画布、版本和运行轨迹中。",
        primaryCta: "下载 Aflow",
        secondaryCta: "查看技术层",
      },
      products: {
        label: "Products",
        title: "Aflow 分为 Aflow Agent、Aflow Specflow、Aflow Designer 三个产品。",
        body: "Aflow Agent 服务流程创建和运行；Aflow Specflow 是 workflow runtime 与可视化基础层；Aflow Designer 服务 PM 和前端 Designer 的产品设计工作。",
        aflowTitle: "Aflow Agent",
        aflowStatus: "已上线",
        aflowBody: "一个靠工作流生存的 Agent。它辅助团队搭建 Aflow Specflow workflow，维护 prompt 与分支，观察运行反馈，并把经验转化为下一版流程。",
        specflowTitle: "Aflow Specflow",
        specflowStatus: "Runtime foundation",
        specflowBody: "面向 Agent 工作的 workflow-as-code 基础设施：可视化图、节点、关卡、跨 session 上下文、运行日志和可审查的流程定义。",
        specflowPoints: ["Workflow as Code", "Agent handoffs", "Human gates", "Persistent sessions", "Run traces"],
        designerTitle: "Aflow Designer",
        designerStatus: "Design workspace",
        designerBody: "面向 PM 和前端 Designer 的产品设计工作台：创建 HTML 或 React project，预览多 frame 设计稿和线框图，附加 reference，点击元素提修改，并记录设计版本。",
        designerPoints: ["HTML / React projects", "Canvas preview", "Reference chips", "Element comments", "Git versions"],
        cta: "下载 Aflow",
      },
      download: {
        title: "下载 Aflow",
        body: "如果你要二进制文件，去 GitHub Releases。若你喜欢从终端开始，下面是 README 中的安装命令。",
        releasesTitle: "二进制下载",
        releasesBody: "选择适合系统的 release asset。稳定版使用 vX.Y.Z；alpha、beta、rc 等预发布版本也会出现在 Releases。",
        releasesCta: "打开 GitHub Releases",
        commandCta: "命令行下载",
        commandTitle: "从命令行安装",
        commandBody: "安装脚本固定在 install-v2 tag；如需指定版本，在命令后追加 release tag。",
        backHome: "返回首页",
        groups: [
          ["macOS / Linux · 最新稳定版", "curl -fsSL https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v2/install/install.sh | bash"],
          ["macOS / Linux · 指定版本", "curl -fsSL https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v2/install/install.sh | bash -s -- v0.0.1-beta.2"],
          ["Windows PowerShell · 最新稳定版", "& ([scriptblock]::Create((irm \"https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v2/install/install.ps1\")))"],
          ["Windows PowerShell · 指定版本", "& ([scriptblock]::Create((irm \"https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v2/install/install.ps1\"))) \"v0.0.1-beta.2\""],
        ],
      },
      docs: {
        title: "文档",
        body: "阅读 Aflow Agent、Aflow Specflow 与 Aflow Designer 的教程。左侧按公开文档目录分组；未来新增的文档目录也会自动出现在这里。",
        loading: "正在加载文档...",
        error: "文档加载失败。",
        noDocs: "当前语言暂无文档。",
        sections: "文档目录",
        onThisPage: "本文目录",
        updatedAt: "更新于",
        openSource: "查看 Markdown",
      },
      footer: {
        descriptor: "Agent workflow, runtime, and design workspace built on Aflow Specflow.",
        note: "Aflow Agent runs workflows. Aflow Specflow keeps the trace. Aflow Designer creates frames.",
      },
    },
    "en-US": {
      meta: {
        homeTitle: "Aflow - Agent, Specflow, Designer",
        homeDescription: "Aflow brings agent workflows, the Aflow Specflow runtime, and product design into one local system.",
        downloadTitle: "Download Aflow",
        downloadDescription: "Download Aflow binaries from GitHub Releases or install from the command line.",
        docsTitle: "Aflow Docs",
        docsDescription: "Read tutorials and reference docs for Aflow Agent, Aflow Specflow, and Aflow Designer.",
        productsTitle: "Aflow Products",
        productsDescription: "Explore Aflow Agent, Aflow Specflow, and Aflow Designer: the workflow agent, runtime foundation, and product design workspace.",
        siteName: "Aflow",
      },
      accessibility: {
        primaryNavigation: "Primary navigation",
        languageSelector: "Select language",
        themeSelector: "Select theme",
        skipToContent: "Skip to content",
        mobileMenuOpen: "Open navigation menu",
        mobileMenuClose: "Close navigation menu",
        previewSummary: "Aflow product map with Aflow Agent, Aflow Specflow, Aflow Designer, References, and Versions nodes.",
      },
      navigation: {
        product: "Product",
        aflowSoon: "Workflow agent",
        specflow: "Runtime foundation",
        designer: "Product design workspace",
        useCases: "Use cases",
        technical: "Technical",
        docs: "Docs",
        download: "Download",
        github: "GitHub",
        primaryCta: "Download",
      },
      hero: {
        badge: "Design workspace + Agent workflows",
        titleRows: [
          { kind: "kicker", text: "From" },
          { kind: "statement", text: "Before Workflow" },
          { kind: "kicker", text: "to" },
          { kind: "statement", text: "After Workflow" },
        ],
        body: "Aflow Agent is built on Specflow. It is not another chat window; it is a workflow-native agent that helps teams design, run, maintain, and improve durable agent processes. Workflows give it bones, feedback gives it memory, and domain agents give it judgment.",
        primaryCta: "Download Aflow",
        secondaryCta: "Explore products",
        supportLine: "Aflow Agent · Aflow Specflow · Aflow Designer",
        monoLabel: "Before: scattered agent work. After: workflow-native design, runtime, and execution.",
      },
      preview: {
        eyebrow: "product workspace",
        title: "Design, workflow, runtime",
        startRun: "preview loop",
        caption: "Aflow Agent, Aflow Specflow, and Aflow Designer form one local workspace: agentic execution, runtime traces, and product design artifacts evolve together.",
        nodes: [
          ["A1", "Aflow Agent", "workflow planning", "done"],
          ["S1", "Aflow Specflow", "runtime + logs", "running"],
          ["D1", "Aflow Designer", "HTML / React frames", "ready"],
          ["R1", "References", "repo + interface notes", "waiting"],
          ["V1", "Versions", "artifact history", "queued"],
        ],
        trace: ["workflow captured", "runtime trace recorded", "design frame versioned"],
      },
      workflowPhases: {
        label: "Before / During / After",
        title: "Before, during, and after the workflow are different jobs.",
        body: "Aflow does not compress the whole lifecycle into one button. It gives agentic work three natural stages: prepare design and inputs, orchestrate execution, then resume the real agent session to refine the result.",
        items: [
          {
            step: "Before",
            title: "Before: design and prepare",
            product: "Aflow Designer",
            body: "Use references, HTML/React frames, wireframes, element comments, and version history to turn PM or frontend design intent into previewable interface artifacts.",
          },
          {
            step: "During",
            title: "During: orchestrate and run",
            product: "Aflow Agent + Aflow Specflow",
            body: "Break work into nodes, sessions, human gates, and run logs. Agents stop improvising inside a chat and collaborate inside a reviewable workflow.",
          },
          {
            step: "After",
            title: "After: resume and refine",
            product: "Native agent session",
            body: "After the run, resume into the native agent session to continue manually, improve the output, add judgment, and carry context back into later work.",
          },
        ],
      },
      values: [
        {
          label: "01",
          title: "Aflow Agent turns complex work into runnable workflows.",
          body: "Requirements, design, implementation, review, and rework stop living in one long chat. They become visible nodes, human gates, cross-session context, and reusable workflow-as-code.",
        },
        {
          label: "02",
          title: "Aflow Specflow keeps the runtime reviewable and recoverable.",
          body: "Agent servers, ACP sessions, run logs, artifacts, versions, and workflow files have clear homes, so teams can inspect what happened and continue from older states.",
        },
        {
          label: "03",
          title: "Aflow Designer gives non-engineering roles a real design surface.",
          body: "PMs and frontend designers can create HTML or React projects, review multi-frame designs, switch to wireframes, inspect hierarchy, attach reference context, and comment on exact elements.",
        },
      ],
      useCases: {
        label: "Use cases",
        title: "From design frames to agent workflows, Aflow keeps both artifacts and process alive.",
        body: "The same workspace can carry product design, software delivery, and business agent orchestration. Designers see a canvas, engineers see workflows, and teams see a traceable process.",
        items: [
          {
            title: "Product Design",
            flow: "Reference -> Prompt -> HTML/React Frames -> Wireframe -> Comment -> Version",
            body: "Designer turns product ideas into previewable multi-frame artifacts. Users can attach references, click elements for changes, record versions, and hand results into implementation workflows.",
            stats: ["HTML/React project", "wireframe mode", "version history"],
          },
          {
            title: "Software Delivery",
            flow: "Requirement -> Spec -> Plan -> Code -> Test -> Review",
            body: "Requirements, specs, implementation, tests, review, and rework paths live in one graph. Code agents can move fast; the workflow stays inspectable.",
            stats: ["spec generated", "tests passed", "review approved"],
          },
          {
            title: "Agent Operations",
            flow: "Intake -> Specialist Agent -> Gate -> Rework -> Deliver -> Resume",
            body: "Teams can connect domain agents to the same runnable graph. Aflow manages order, human judgment, handoffs, and session recovery.",
            stats: ["persistent sessions", "human gates", "run traces"],
          },
        ],
      },
      technical: {
        label: "Built on Aflow Specflow",
        title: "Three entrypoints, one local runtime foundation.",
        body: "Aflow Agent is for workflow creation and execution. Aflow Specflow is for visual workflows, run logs, and session recovery. Aflow Designer is for product interface design. They share agent configuration, ACP connections, workspace files, and traceable runtime history.",
        tags: ["Aflow Agent", "Aflow Specflow runtime", "Aflow Designer projects", "ACP timeline", "Local versioning"],
        command: ["$ aflow", "1. Aflow Agent", "2. Aflow Specflow", "3. Aflow Designer"],
      },
      closing: {
        title: "Give design artifacts, workflows, and agent memory a durable shape.",
        body: "Product design should not end as a chat screenshot, and agent collaboration should not disappear into temporary prompts. Aflow brings both back into files, canvases, versions, and run traces.",
        primaryCta: "Download Aflow",
        secondaryCta: "View technical layer",
      },
      products: {
        label: "Products",
        title: "Aflow is split into Aflow Agent, Aflow Specflow, and Aflow Designer.",
        body: "Aflow Agent handles workflow creation and execution. Aflow Specflow is the workflow runtime and visual foundation. Aflow Designer serves PMs and frontend designers working on product interfaces.",
        aflowTitle: "Aflow Agent",
        aflowStatus: "Available now",
        aflowBody: "A workflow-native agent that helps teams build Aflow Specflow workflows, maintain prompts and branches, watch run feedback, and turn experience into the next workflow revision.",
        specflowTitle: "Aflow Specflow",
        specflowStatus: "Runtime foundation",
        specflowBody: "Workflow-as-code infrastructure for agent work: visual graphs, nodes, gates, cross-session context, run logs, and reviewable process definitions.",
        specflowPoints: ["Workflow as Code", "Agent handoffs", "Human gates", "Persistent sessions", "Run traces"],
        designerTitle: "Aflow Designer",
        designerStatus: "Design workspace",
        designerBody: "A product design workspace for PMs and frontend designers: create HTML or React projects, preview multi-frame designs and wireframes, attach references, comment on elements, and record versions.",
        designerPoints: ["HTML / React projects", "Canvas preview", "Reference chips", "Element comments", "Git versions"],
        cta: "Download Aflow",
      },
      download: {
        title: "Download Aflow",
        body: "For binaries, use GitHub Releases. If you prefer starting from a terminal, use the install commands from the README.",
        releasesTitle: "Binary downloads",
        releasesBody: "Choose the release asset for your system. Stable releases use vX.Y.Z; alpha, beta, and rc builds are also published there.",
        releasesCta: "Open GitHub Releases",
        commandCta: "Command line install",
        commandTitle: "Install from command line",
        commandBody: "The installer is pinned to the install-v2 tag. Pass a release tag when you want a specific version.",
        backHome: "Back home",
        groups: [
          ["macOS / Linux · latest stable", "curl -fsSL https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v2/install/install.sh | bash"],
          ["macOS / Linux · specific version", "curl -fsSL https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v2/install/install.sh | bash -s -- v0.0.1-beta.2"],
          ["Windows PowerShell · latest stable", "& ([scriptblock]::Create((irm \"https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v2/install/install.ps1\")))"],
          ["Windows PowerShell · specific version", "& ([scriptblock]::Create((irm \"https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v2/install/install.ps1\"))) \"v0.0.1-beta.2\""],
        ],
      },
      docs: {
        title: "Docs",
        body: "Read tutorials for Aflow Agent, Aflow Specflow, and Aflow Designer. The left sidebar is grouped by public docs directory; future documentation sections will appear here automatically.",
        loading: "Loading docs...",
        error: "Could not load this document.",
        noDocs: "No docs are available for this language yet.",
        sections: "Documentation",
        onThisPage: "On this page",
        updatedAt: "Updated",
        openSource: "View Markdown",
      },
      footer: {
        descriptor: "Agent workflow, runtime, and design workspace built on Aflow Specflow.",
        note: "Aflow Agent runs workflows. Aflow Specflow keeps the trace. Aflow Designer creates frames.",
      },
    },
  };

  let locale = getInitialLocale();
  let theme = getInitialTheme();
  let menuOpen = false;
  const app = document.getElementById("app");

  function getInitialLocale() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (LOCALES.includes(stored)) return stored;
    } catch (_error) {}
    return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  }

  function getInitialTheme() {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (THEMES.includes(stored)) return stored;
    } catch (_error) {}
    return "dark";
  }

  function persist(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_error) {}
  }

  function setMeta(selector, attribute, value) {
    const element = document.querySelector(selector);
    if (element) element.setAttribute(attribute, value);
  }

  function updateMetadata(t) {
    const title = page === "download" ? t.meta.downloadTitle : page === "products" ? t.meta.productsTitle : page === "docs" ? t.meta.docsTitle : t.meta.homeTitle;
    const description = page === "download" ? t.meta.downloadDescription : page === "products" ? t.meta.productsDescription : page === "docs" ? t.meta.docsDescription : t.meta.homeDescription;
    document.documentElement.lang = locale;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    setMeta("meta[name='theme-color']", "content", theme === "dark" ? "#07090f" : "#eef1ec");
    document.title = title;
    setMeta("meta[name='description']", "content", description);
    setMeta("meta[property='og:title']", "content", title);
    setMeta("meta[property='og:description']", "content", description);
    setMeta("meta[property='og:site_name']", "content", t.meta.siteName);
  }

  function icon(name) {
    const paths = {
      play: '<path d="M8 5v14l11-7-11-7Z"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.41M17.66 6.34l1.41-1.41"/>',
      moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>',
      branch: '<path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M9 6h4a5 5 0 0 1 5 5v1"/><circle cx="18" cy="15" r="3"/>',
      external: '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
      terminal: '<path d="m4 17 6-5-6-5"/><path d="M12 19h8"/>',
      arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
      chevron: '<path d="m6 9 6 6 6-6"/>',
    };
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
  }

  function brandMark() {
    return `<span class="brand-mark"><img src="assets/favicon/favicon.svg" alt="" aria-hidden="true" /></span>`;
  }

  function pageHref(fragment) {
    return page === "home" ? fragment : `index.html${fragment}`;
  }

  function docsLocale() {
    return DOCS_LOCALE[locale] || "en";
  }

  function titleCase(value) {
    return String(value || "")
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function slugify(value) {
    const slug = String(value)
      .trim()
      .toLowerCase()
      .replace(/[`*_~[\]()]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "section";
  }

  function uniqueSlug(base, used) {
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  }

  function stripFrontmatter(markdown) {
    if (!markdown.startsWith("---\n")) return { frontmatter: {}, body: markdown };
    const end = markdown.indexOf("\n---", 4);
    if (end === -1) return { frontmatter: {}, body: markdown };
    const frontmatter = {};
    markdown.slice(4, end).split(/\r?\n/).forEach((line) => {
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (match) frontmatter[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    });
    return { frontmatter, body: markdown.slice(end + 4).replace(/^\r?\n/, "") };
  }

  function inlineMarkdown(value) {
    const code = [];
    let text = escapeHtml(value).replace(/`([^`]+)`/g, (_match, inner) => {
      code.push(`<code>${inner}</code>`);
      return `\u0000${code.length - 1}\u0000`;
    });
    text = text
      .replace(/\[([^\]]+)]\(([^)]+)\)/g, (_match, label, href) => `<a href="${escapeHtml(href)}">${label}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return text.replace(/\u0000(\d+)\u0000/g, (_match, index) => code[Number(index)] || "");
  }

  function renderTable(lines) {
    const rows = lines.map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
    if (rows.length < 2) return "";
    const head = rows[0].map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("");
    const body = rows.slice(2).map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("");
    return `<div class="markdown-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function renderMarkdown(markdown) {
    const { frontmatter, body } = stripFrontmatter(markdown);
    const lines = body.replace(/\r\n/g, "\n").split("\n");
    const chunks = [];
    const headings = [];
    const usedSlugs = new Map();
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      const fence = line.match(/^```(\w+)?\s*$/);
      if (fence) {
        const language = fence[1] || "";
        const codeLines = [];
        index += 1;
        while (index < lines.length && !lines[index].startsWith("```")) {
          codeLines.push(lines[index]);
          index += 1;
        }
        index += 1;
        chunks.push(`<pre><code${language ? ` data-language="${escapeHtml(language)}"` : ""}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        const text = heading[2].trim();
        const id = uniqueSlug(slugify(text), usedSlugs);
        headings.push({ level, text, id });
        chunks.push(`<h${level} id="${id}">${inlineMarkdown(text)}</h${level}>`);
        index += 1;
        continue;
      }

      if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
        const tableLines = [line, lines[index + 1]];
        index += 2;
        while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
          tableLines.push(lines[index]);
          index += 1;
        }
        chunks.push(renderTable(tableLines));
        continue;
      }

      const unordered = line.match(/^\s*-\s+(.+)$/);
      if (unordered) {
        const items = [];
        while (index < lines.length) {
          const item = lines[index].match(/^\s*-\s+(.+)$/);
          if (!item) break;
          items.push(`<li>${inlineMarkdown(item[1])}</li>`);
          index += 1;
        }
        chunks.push(`<ul>${items.join("")}</ul>`);
        continue;
      }

      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (ordered) {
        const items = [];
        while (index < lines.length) {
          const item = lines[index].match(/^\s*\d+\.\s+(.+)$/);
          if (!item) break;
          items.push(`<li>${inlineMarkdown(item[1])}</li>`);
          index += 1;
        }
        chunks.push(`<ol>${items.join("")}</ol>`);
        continue;
      }

      const paragraph = [line.trim()];
      index += 1;
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^#{1,4}\s+/.test(lines[index]) &&
        !/^```/.test(lines[index]) &&
        !/^\s*[-*]\s+/.test(lines[index]) &&
        !/^\s*\d+\.\s+/.test(lines[index])
      ) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      chunks.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    }

    return { frontmatter, html: chunks.join("\n"), headings };
  }

  function docsHashSelection() {
    const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "en" || parts[0] === "zh") return { locale: parts[0], section: parts[1], id: parts[2] };
    return { locale: docsLocale(), section: parts[0], id: parts[1] };
  }

  function docsForLocale(manifest, docLocale = docsLocale()) {
    return (manifest?.sections || [])
      .map((section) => ({
        ...section,
        title: section.title || titleCase(section.id),
        items: (section.items || [])
          .filter((item) => item.locale === docLocale)
          .sort((a, b) => Number(a.order || 999) - Number(b.order || 999) || a.title.localeCompare(b.title)),
      }))
      .filter((section) => section.items.length > 0);
  }

  function selectDoc(manifest) {
    const selection = docsHashSelection();
    const sections = docsForLocale(manifest, selection.locale || docsLocale());
    const selected = sections
      .flatMap((section) => section.items.map((item) => ({ section, item })))
      .find(({ section, item }) => section.id === selection.section && item.id === selection.id);
    return selected || sections.flatMap((section) => section.items.map((item) => ({ section, item })))[0] || null;
  }

  function languageSwitcher(t) {
    return `<div class="segmented-switcher language-switcher" role="group" aria-label="${t.accessibility.languageSelector}"><button type="button" data-locale="en-US" aria-pressed="${locale === "en-US"}">EN</button><button type="button" data-locale="zh-CN" aria-pressed="${locale === "zh-CN"}">中文</button></div>`;
  }

  function themeSwitcher(t) {
    return `<div class="icon-switcher" role="group" aria-label="${t.accessibility.themeSelector}"><button type="button" data-theme-choice="light" aria-pressed="${theme === "light"}" aria-label="Day">${icon("sun")}</button><button type="button" data-theme-choice="dark" aria-pressed="${theme === "dark"}" aria-label="Night">${icon("moon")}</button></div>`;
  }

  function productMenu(t) {
    return `<div class="product-menu"><button type="button" aria-haspopup="true">${t.navigation.product}${icon("chevron")}</button><div class="product-menu-panel"><a class="product-menu-item" href="product.html#aflow-agent"><strong>Aflow Agent</strong><em>${t.navigation.aflowSoon}</em></a><a class="product-menu-item" href="product.html#specflow"><strong>Aflow Specflow</strong><em>${t.navigation.specflow}</em></a><a class="product-menu-item" href="product.html#designer"><strong>Aflow Designer</strong><em>${t.navigation.designer}</em></a></div></div>`;
  }

  function header(t) {
    const menuLabel = menuOpen ? t.accessibility.mobileMenuClose : t.accessibility.mobileMenuOpen;
    return `<header class="site-header" data-header><div class="container header-inner"><a class="brand" href="index.html#hero" aria-label="Aflow">${brandMark()}<span>Aflow</span></a><button class="menu-trigger" type="button" data-menu-toggle aria-label="${menuLabel}" aria-expanded="${menuOpen}" aria-controls="primary-menu"><span></span><span></span></button><nav id="primary-menu" class="primary-nav ${menuOpen ? "is-open" : ""}" aria-label="${t.accessibility.primaryNavigation}">${productMenu(t)}<a href="${pageHref("#use-cases")}">${t.navigation.useCases}</a><a href="${pageHref("#technical")}">${t.navigation.technical}</a><a href="docs.html">${t.navigation.docs}</a><a href="download.html">${t.navigation.download}</a><a href="${RELEASES_URL}" target="_blank" rel="noreferrer">${t.navigation.github}</a></nav><div class="header-actions">${themeSwitcher(t)}${languageSwitcher(t)}<a class="button primary header-cta" href="download.html">${icon("arrow")}<span>${t.navigation.primaryCta}</span></a></div></div></header>`;
  }

  function workflowPreview(t) {
    const nodes = t.preview.nodes.map(([id, title, meta, state], index) => `<article class="neo-node neo-node-${index + 1} ${state}"><span>${id}</span><strong>${title}</strong><code>${meta}</code><em>${state}</em></article>`).join("");
    const trace = t.preview.trace.map((line) => `<p><span>✓</span>${line}</p>`).join("");
    return `<figure class="workflow-preview preview reveal" aria-describedby="preview-summary preview-caption"><p id="preview-summary" class="sr-only">${t.accessibility.previewSummary}</p><div class="preview-toolbar"><div class="preview-title">${brandMark()}<div><span class="micro">${t.preview.eyebrow}</span><strong>${t.preview.title}</strong></div></div><button class="decorative-action" type="button" data-run-preview>${icon("play")}${t.preview.startRun}</button></div><div class="preview-canvas hero-canvas"><div class="neo-orbit" aria-hidden="true"></div><svg class="connections" viewBox="0 0 660 360" aria-hidden="true" focusable="false"><path d="M104 186 C170 86 260 86 326 150" class="connector neon animated-connector"/><path d="M332 178 C408 238 492 228 566 158" class="connector cyan animated-connector"/><path d="M352 185 C390 260 468 292 552 268" class="connector warning animated-connector"/></svg>${nodes}</div><div class="session-dock neo-trace"><div class="dock-tabs"><span class="active">Run trace</span><span>Agent sessions</span></div>${trace}</div><figcaption id="preview-caption">${t.preview.caption}</figcaption></figure>`;
  }

  function heroTitle(t) {
    const rows = Array.isArray(t.hero.titleRows)
      ? t.hero.titleRows
      : [{ kind: "statement", text: t.hero.title || "" }];
    return rows.map((row) => {
      const kind = row.kind === "kicker" ? "hero-title-kicker" : "hero-title-main";
      const note = row.note ? `<small>${row.note}</small>` : "";
      return `<span class="hero-title-line ${kind}"><span>${row.text}</span>${note}</span>`;
    }).join("");
  }

  function hero(t) {
    return `<section id="hero" class="hero section" aria-labelledby="hero-title"><div class="hero-orbit" aria-hidden="true">A</div><div class="container hero-layout"><div class="hero-copy reveal"><div class="product-pill">${brandMark()}<strong>Aflow</strong><span>${t.hero.badge}</span></div><h1 id="hero-title">${heroTitle(t)}</h1><p class="hero-body">${t.hero.body}</p><div class="cta-row"><a class="button primary" href="download.html">${icon("arrow")}<span>${t.hero.primaryCta}</span></a><a class="button secondary" href="product.html">${icon("branch")}<span>${t.hero.secondaryCta}</span></a></div><p class="support-line">${t.hero.supportLine}</p><p class="agent-stack">${t.hero.monoLabel}</p></div>${workflowPreview(t)}</div></section>`;
  }

  function workflowPhases(t) {
    const items = t.workflowPhases.items.map((item) => `<article class="phase-card reveal"><span>${item.step}</span><h3>${item.title}</h3><strong>${item.product}</strong><p>${item.body}</p></article>`).join("");
    return `<section id="agentic-workflow" class="workflow-phases section" aria-labelledby="workflow-phases-title"><div class="container"><div class="section-heading reveal"><p class="section-label">${t.workflowPhases.label}</p><h2 id="workflow-phases-title">${t.workflowPhases.title}</h2><p>${t.workflowPhases.body}</p></div><div class="phase-grid">${items}</div></div></section>`;
  }

  function values(t) {
    return `<section id="workflow" class="value-grid section"><div class="container values-layout">${t.values.map((item) => `<article class="value-card reveal"><span>${item.label}</span><h2>${item.title}</h2><p>${item.body}</p></article>`).join("")}</div></section>`;
  }

  function useCases(t) {
    return `<section id="use-cases" class="use-case section" aria-labelledby="use-case-title"><div class="container"><div class="section-heading reveal"><p class="section-label">${t.useCases.label}</p><h2 id="use-case-title">${t.useCases.title}</h2><p>${t.useCases.body}</p></div><div class="case-grid">${t.useCases.items.map((item) => `<article class="case-card reveal"><h3>${item.title}</h3><p>${item.body}</p><code>${item.flow}</code><div>${item.stats.map((stat) => `<span>${stat}</span>`).join("")}</div></article>`).join("")}</div></div></section>`;
  }

  function technical(t) {
    return `<section id="technical" class="architecture section" aria-labelledby="technical-title"><div class="container architecture-layout"><div class="reveal"><p class="section-label">${t.technical.label}</p><h2 id="technical-title">${t.technical.title}</h2><p>${t.technical.body}</p><div class="technical-stack">${t.technical.tags.map((tag) => `<span>${tag}</span>`).join("")}</div></div><pre class="command-card reveal" aria-label="Aflow command example">${t.technical.command.map((line) => `<code>${line}</code>`).join("")}</pre></div></section>`;
  }

  function closing(t) {
    return `<section id="closing" class="closing section" aria-labelledby="closing-title"><div class="container closing-card reveal"><h2 id="closing-title">${t.closing.title}</h2><p>${t.closing.body}</p><div class="cta-row"><a class="button primary" href="download.html">${icon("arrow")}<span>${t.closing.primaryCta}</span></a><a class="button secondary" href="#technical">${icon("terminal")}<span>${t.closing.secondaryCta}</span></a></div></div></section>`;
  }

  function productsPage(t) {
    const designerPoints = t.products.designerPoints.map((point) => `<span>${point}</span>`).join("");
    const points = t.products.specflowPoints.map((point) => `<span>${point}</span>`).join("");
    return `<main id="main-content" class="products-page" tabindex="-1"><section class="products-hero section"><div class="container reveal"><p class="section-label">${t.products.label}</p><h1>${t.products.title}</h1><p>${t.products.body}</p></div></section><section class="products-section section"><div class="container product-grid"><article id="aflow-agent" class="product-card reveal"><span>${t.products.aflowStatus}</span><h2>${t.products.aflowTitle}</h2><p>${t.products.aflowBody}</p></article><article id="specflow" class="product-card reveal"><span>${t.products.specflowStatus}</span><h2>${t.products.specflowTitle}</h2><p>${t.products.specflowBody}</p><div class="technical-stack">${points}</div></article><article id="designer" class="product-card reveal"><span>${t.products.designerStatus}</span><h2>${t.products.designerTitle}</h2><p>${t.products.designerBody}</p><div class="technical-stack">${designerPoints}</div></article></div><div class="container product-cta reveal"><a class="button primary" href="download.html">${icon("arrow")}<span>${t.products.cta}</span></a></div></section></main>`;
  }

  function commandGroup(group) {
    return `<article class="download-command"><h3>${group[0]}</h3><pre><code>${group[1]}</code></pre></article>`;
  }

  function downloadPage(t) {
    return `<main id="main-content" class="download-page" tabindex="-1"><section class="download-hero section"><div class="container download-hero-layout"><div><h1>${t.download.title}</h1><p>${t.download.body}</p><div class="cta-row"><a class="button primary" href="${RELEASES_URL}" target="_blank" rel="noreferrer">${icon("external")}<span>${t.download.releasesCta}</span></a><a class="button secondary" href="#command-line">${icon("terminal")}<span>${t.download.commandCta}</span></a><a class="button secondary" href="index.html#hero">${icon("branch")}<span>${t.download.backHome}</span></a></div></div><aside class="release-card"><span>GitHub Releases</span><h2>${t.download.releasesTitle}</h2><p>${t.download.releasesBody}</p></aside></div></section><section id="command-line" class="download-section section"><div class="container"><div class="section-heading"><h2>${t.download.commandTitle}</h2><p>${t.download.commandBody}</p></div><div class="download-grid">${t.download.groups.map(commandGroup).join("")}</div></div></section></main>`;
  }

  function docsSidebar(t, sections, current) {
    if (!sections.length) return `<p class="docs-empty">${t.docs.noDocs}</p>`;
    return sections.map((section) => {
      const items = section.items.map((item) => {
        const active = current?.section.id === section.id && current?.item.id === item.id;
        return `<a class="${active ? "is-active" : ""}" href="docs.html#/${docsLocale()}/${section.id}/${item.id}"><strong>${escapeHtml(item.title)}</strong>${item.description ? `<span>${escapeHtml(item.description)}</span>` : ""}</a>`;
      }).join("");
      return `<section class="docs-nav-section"><h2>${escapeHtml(section.title)}</h2>${items}</section>`;
    }).join("");
  }

  function docsToc(t) {
    const headings = docsState.headings.filter((heading) => heading.level > 1 && heading.level < 4);
    if (!headings.length) return "";
    return `<aside class="docs-toc" aria-label="${t.docs.onThisPage}"><h2>${t.docs.onThisPage}</h2>${headings.map((heading) => `<a class="level-${heading.level}" href="#${heading.id}">${escapeHtml(heading.text)}</a>`).join("")}</aside>`;
  }

  function docsArticle(t) {
    if (docsState.error) return `<article class="docs-article"><p class="docs-error">${t.docs.error}</p><pre><code>${escapeHtml(docsState.error)}</code></pre></article>`;
    if (docsState.loadingKey || docsState.manifestLoading) return `<article class="docs-article"><p class="docs-loading">${t.docs.loading}</p></article>`;
    if (!docsState.currentDoc || !docsState.html) return `<article class="docs-article"><p class="docs-empty">${t.docs.noDocs}</p></article>`;
    const updatedAt = docsState.currentDoc.updatedAt ? `<span>${t.docs.updatedAt} ${escapeHtml(docsState.currentDoc.updatedAt)}</span>` : "";
    return `<article class="docs-article"><header class="docs-article-header"><p class="section-label">${escapeHtml(docsState.currentDoc.sectionTitle)}</p><h1>${escapeHtml(docsState.currentDoc.title)}</h1>${docsState.currentDoc.description ? `<p>${escapeHtml(docsState.currentDoc.description)}</p>` : ""}<div>${updatedAt}<a href="${escapeHtml(docsState.currentDoc.path)}" target="_blank" rel="noreferrer">${t.docs.openSource}</a></div></header><div class="markdown-body">${docsState.html}</div></article>`;
  }

  function docsPage(t) {
    const sections = docsForLocale(docsState.manifest);
    const current = selectDoc(docsState.manifest);
    return `<main id="main-content" class="docs-page" tabindex="-1"><section class="docs-hero section"><div class="container"><p class="section-label">Docs</p><h1>${t.docs.title}</h1><p>${t.docs.body}</p></div></section><section class="docs-shell section"><div class="container docs-layout"><aside class="docs-sidebar" aria-label="${t.docs.sections}"><h1>${t.docs.sections}</h1>${docsSidebar(t, sections, current)}</aside><div class="docs-content">${docsArticle(t)}</div>${docsToc(t)}</div></section></main>`;
  }

  async function loadDocs() {
    if (page !== "docs") return;
    if (!docsState.manifest && !docsState.manifestLoading) {
      docsState.manifestLoading = true;
      render();
      try {
        const response = await fetch("docs/manifest.json");
        if (!response.ok) throw new Error(`manifest ${response.status}`);
        docsState.manifest = await response.json();
        docsState.error = "";
      } catch (error) {
        docsState.error = error instanceof Error ? error.message : String(error);
      } finally {
        docsState.manifestLoading = false;
        render();
      }
      return;
    }
    if (!docsState.manifest) return;
    const selected = selectDoc(docsState.manifest);
    if (!selected) return;
    const key = `${selected.item.locale}/${selected.section.id}/${selected.item.id}`;
    if (docsState.currentKey === key && docsState.html) return;
    if (docsState.loadingKey === key) return;
    docsState.loadingKey = key;
    docsState.error = "";
    render();
    try {
      const response = await fetch(selected.item.path);
      if (!response.ok) throw new Error(`${selected.item.path} ${response.status}`);
      const markdown = await response.text();
      const rendered = renderMarkdown(markdown);
      docsState.currentKey = key;
      docsState.currentDoc = {
        ...selected.item,
        sectionTitle: selected.section.title,
        title: rendered.frontmatter.title || selected.item.title,
        description: rendered.frontmatter.description || selected.item.description,
        updatedAt: rendered.frontmatter.updatedAt || selected.item.updatedAt || "",
      };
      docsState.html = rendered.html;
      docsState.headings = rendered.headings;
      docsState.error = "";
    } catch (error) {
      docsState.error = error instanceof Error ? error.message : String(error);
    } finally {
      docsState.loadingKey = "";
      render();
    }
  }

  function footer(t) {
    return `<footer class="site-footer"><div class="container footer-layout"><div class="footer-brand"><a class="brand" href="index.html#hero">${brandMark()}<span>Aflow</span></a><p>${t.footer.descriptor}</p></div><nav class="footer-links" aria-label="${t.accessibility.primaryNavigation}"><a href="product.html">${t.navigation.product}</a><a href="docs.html">${t.navigation.docs}</a><a href="download.html">${t.navigation.download}</a><a href="${pageHref("#technical")}">${t.navigation.technical}</a><a href="${RELEASES_URL}" target="_blank" rel="noreferrer">GitHub</a></nav><p class="footer-note">${t.footer.note}</p></div></footer>`;
  }

  function render() {
    const t = copy[locale];
    updateMetadata(t);
    const main = page === "download"
      ? downloadPage(t)
      : page === "products"
        ? productsPage(t)
        : page === "docs"
          ? docsPage(t)
          : `<main id="main-content" tabindex="-1">${hero(t)}${workflowPhases(t)}${values(t)}${useCases(t)}${technical(t)}${closing(t)}</main>`;
    app.innerHTML = `<a class="skip-link" href="#main-content">${t.accessibility.skipToContent}</a>${header(t)}${main}${footer(t)}`;
    bindControls();
    bindMotion();
    app.querySelector("[data-header]")?.classList.toggle("has-scroll", window.scrollY > 8);
    if (page === "docs") loadDocs();
  }

  function bindMotion() {
    if (revealObserver) revealObserver.disconnect();
    const revealItems = Array.from(app.querySelectorAll(".reveal"));
    if (!revealItems.length) return;
    if (!("IntersectionObserver" in window)) {
      revealItems.forEach((item) => item.classList.add("is-visible"));
    } else {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: "0px 0px -12% 0px", threshold: 0.15 });
      revealItems.forEach((item, index) => {
        item.style.setProperty("--reveal-delay", `${Math.min(index % 4, 3) * 80}ms`);
        revealObserver.observe(item);
      });
    }

    app.querySelectorAll("[data-run-preview]").forEach((button) => {
      button.addEventListener("click", () => {
        const preview = button.closest(".workflow-preview");
        if (!preview) return;
        preview.classList.remove("is-running");
        void preview.offsetWidth;
        preview.classList.add("is-running");
      });
    });
  }

  function bindControls() {
    app.querySelectorAll("[data-locale]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextLocale = button.dataset.locale;
        if (!LOCALES.includes(nextLocale) || nextLocale === locale) return;
        const scrollPosition = window.scrollY;
        const previousDoc = page === "docs" ? selectDoc(docsState.manifest) : null;
        locale = nextLocale;
        menuOpen = false;
        persist(STORAGE_KEY, locale);
        if (previousDoc) {
          window.history.replaceState(null, "", `#/${docsLocale()}/${previousDoc.section.id}/${previousDoc.item.id}`);
          docsState.html = "";
          docsState.currentKey = "";
        }
        render();
        window.scrollTo(0, scrollPosition);
      });
    });
    app.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextTheme = button.dataset.themeChoice;
        if (!THEMES.includes(nextTheme) || nextTheme === theme) return;
        const scrollPosition = window.scrollY;
        theme = nextTheme;
        persist(THEME_STORAGE_KEY, theme);
        render();
        window.scrollTo(0, scrollPosition);
      });
    });
    const toggle = app.querySelector("[data-menu-toggle]");
    toggle?.addEventListener("click", () => {
      menuOpen = !menuOpen;
      render();
      app.querySelector("[data-menu-toggle]")?.focus();
    });
    app.querySelectorAll(".primary-nav a").forEach((link) => {
      link.addEventListener("click", () => {
        if (menuOpen) {
          menuOpen = false;
          render();
        }
      });
    });
  }

  window.addEventListener("scroll", () => {
    app.querySelector("[data-header]")?.classList.toggle("has-scroll", window.scrollY > 8);
  }, { passive: true });

  window.addEventListener("hashchange", () => {
    if (page !== "docs") return;
    docsState.html = "";
    docsState.currentKey = "";
    render();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuOpen) {
      menuOpen = false;
      render();
      app.querySelector("[data-menu-toggle]")?.focus();
    }
  });

  render();
})();
