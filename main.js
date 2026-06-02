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

  const copy = {
    "zh-CN": {
      meta: {
        homeTitle: "Aflow - Agentic Workflow Agent",
        homeDescription: "Aflow Agent 构建在 Specflow 之上，是一个靠工作流生存的 Agent：辅助设计、优化并运行可复用的 Agent 工作流。",
        downloadTitle: "下载 Aflow",
        downloadDescription: "从 GitHub Releases 下载 Aflow 二进制文件，或使用 README 中的安装命令。",
        docsTitle: "Aflow 文档",
        docsDescription: "阅读 Aflow 与 Specflow 的教程、命令和 workspace 文档。",
        productsTitle: "Aflow 产品",
        productsDescription: "了解 Aflow Agent 与 Specflow：一个是即将到来的工作流 Agent，一个是支撑它的工作流基础设施。",
        siteName: "Aflow",
      },
      accessibility: {
        primaryNavigation: "主导航",
        languageSelector: "选择语言",
        themeSelector: "选择主题",
        skipToContent: "跳到主要内容",
        mobileMenuOpen: "打开导航菜单",
        mobileMenuClose: "关闭导航菜单",
        previewSummary: "Aflow 工作流星图，展示 Intake、Research、Execute、Review Gate、Deliver 节点，以及上下文交接和运行追踪。",
      },
      navigation: {
        product: "产品",
        aflowSoon: "Aflow Agent · 敬请期待",
        specflow: "Specflow",
        useCases: "场景",
        technical: "技术",
        docs: "文档",
        download: "下载",
        github: "GitHub",
        primaryCta: "下载",
      },
      hero: {
        badge: "Agentic Workflow Agent",
        title: "让 Agent 学会在流程中生长。",
        body: "Aflow Agent 构建在 Specflow 之上。它不是又一个聊天窗口，而是一个靠工作流生存的 Agent：帮助团队设计、运行、维护并优化那些稳定而复杂的业务流程。流程给它骨架，反馈给它记忆，行业 Agent 给它真正的判断力。",
        primaryCta: "下载 Aflow",
        secondaryCta: "查看场景",
        supportLine: "Built on Specflow · Workflow-native agent · Human gates · Persistent sessions · Workflow as Code",
        monoLabel: "Specflow gives the workflow foundation. Aflow Agent learns to operate on top of it.",
      },
      preview: {
        eyebrow: "agentic workflow",
        title: "Aflow operating on Specflow",
        startRun: "run workflow",
        caption: "流程不再散落在聊天里。每一步都有职责，每一次交接都有形状，每一次判断都留下痕迹。",
        nodes: [
          ["01", "Intake", "agent: aflow-planner", "done"],
          ["02", "Research", "session: persisted", "running"],
          ["03", "Optimize", "prompt + branch update", "ready"],
          ["G1", "Review Gate", "human approval", "waiting"],
          ["04", "Run", "specflow workflow", "queued"],
        ],
        trace: ["workflow drafted", "domain agent assigned", "review gate waiting"],
      },
      values: [
        {
          label: "01",
          title: "先有流程，再有进化。",
          body: "Aflow Agent 不把任务揉成一团长对话。它把工作拆进 Specflow 的节点、关卡和交接里，让复杂协作有可以生长的骨架。",
        },
        {
          label: "02",
          title: "企业构建 Agent，Aflow 编排它们。",
          body: "行业团队专注候选人判断、代码实现、研究核验等专业能力；Aflow 负责让这些能力按稳定顺序运行、返工、审查和沉淀。",
        },
        {
          label: "03",
          title: "反馈不是噪音，是下一版工作流。",
          body: "当人类修改 prompt、替换 Agent、调整分支或补充约束，Aflow 将这些痕迹变成后续 workflow 的改进线索。",
        },
      ],
      useCases: {
        label: "Use cases",
        title: "Aflow 面向的不是某个行业，而是所有需要秩序的 Agent 工作。",
        body: "不同企业会拥有不同的行业 Agent。Aflow 的使命，是让它们进入同一张可运行、可审查、可迭代的工作流图。",
        items: [
          {
            title: "Executive Search / 猎头",
            flow: "Role Intake -> Market Map -> Candidate Fit -> Outreach -> Human Review -> Client Brief",
            body: "猎头公司的壁垒不是“下一步做什么”，而是候选人判断、行业 mapping、触达质量和客户沟通。Aflow 固定流程，让招聘 Agent 专注判断。",
            stats: ["128 profiles mapped", "23 high-fit candidates", "7 shortlisted"],
          },
          {
            title: "Software Delivery / 代码交付",
            flow: "Requirement -> Spec -> Plan -> Code -> Test -> Review",
            body: "需求澄清、spec、实现、测试、审查与返工路径都在同一张图里。Code Agent 可以强，但流程要可复盘。",
            stats: ["spec generated", "tests passed", "review approved"],
          },
          {
            title: "Research / 行业研究",
            flow: "Question -> Sources -> Cross-check -> Synthesis -> Review -> Report",
            body: "把资料收集、交叉验证、综合判断和报告输出拆给不同 Agent。结论不再只是一段漂亮文字，而是有来源、有路径。",
            stats: ["sources checked", "claims reviewed", "report ready"],
          },
        ],
      },
      technical: {
        label: "Built on Specflow",
        title: "Aflow 站在工作流基础设施之上。",
        body: "Specflow 提供 workflow-as-code、持久 session、结构化交接、human gate 和 run log。Aflow Agent 将使用这些能力辅助创建、优化和运行工作流，让工作流不只是被执行，也能被照看、被修订、被继承。",
        tags: ["Workflow as Code", "Aflow Agent", "Specflow runtime", "Persistent sessions", "Human review gates"],
        command: ["$ aflow run hiring-pipeline.yaml", "✓ workflow inspected", "✓ agent handoff refined", "⧗ human gate: shortlist review"],
      },
      closing: {
        title: "让每一次 Agent 协作，都成为组织可以再次运行的能力。",
        body: "不是把流程藏进提示词里，而是让流程长出形状。Aflow Agent 将在形状之上工作：设计它、运行它、维护它，并让它随业务一起变得更好。",
        primaryCta: "下载 Aflow",
        secondaryCta: "查看技术层",
      },
      products: {
        label: "Products",
        title: "Aflow Agent 与 Specflow，是上下两层产品。",
        body: "Specflow 是工作流基础设施；Aflow Agent 是构建在其上的 Agentic Workflow Agent。一个提供可运行的流程骨架，一个在骨架上协助设计、优化和运行。",
        aflowTitle: "Aflow Agent",
        aflowStatus: "敬请期待",
        aflowBody: "一个靠工作流生存的 Agent。它将辅助团队搭建 Specflow workflow，维护 prompt 与分支，观察运行反馈，并把经验转化为下一版流程。",
        specflowTitle: "Specflow",
        specflowStatus: "Available foundation",
        specflowBody: "面向 Agent 工作的 workflow-as-code 基础设施：可视化图、节点、关卡、跨 session 上下文、运行日志和可审查的流程定义。",
        specflowPoints: ["Workflow as Code", "Agent handoffs", "Human gates", "Persistent sessions", "Run traces"],
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
        body: "阅读 Aflow Agent 与 Specflow 的教程。左侧按公开文档目录分组；未来新增的文档目录也会自动出现在这里。",
        loading: "正在加载文档...",
        error: "文档加载失败。",
        noDocs: "当前语言暂无文档。",
        sections: "文档目录",
        onThisPage: "本文目录",
        updatedAt: "更新于",
        openSource: "查看 Markdown",
      },
      footer: {
        descriptor: "Agentic Workflow Agent built on Specflow.",
        note: "Specflow gives the workflow foundation. Aflow Agent learns to operate on top of it.",
      },
    },
    "en-US": {
      meta: {
        homeTitle: "Aflow - Agentic Workflow Agent",
        homeDescription: "Aflow Agent is built on Specflow: a workflow-native agent that helps design, optimize, and run durable agent workflows.",
        downloadTitle: "Download Aflow",
        downloadDescription: "Download Aflow binaries from GitHub Releases or install from the command line.",
        docsTitle: "Aflow Docs",
        docsDescription: "Read tutorials and reference docs for Aflow and Specflow.",
        productsTitle: "Aflow Products",
        productsDescription: "Learn how Aflow Agent and Specflow fit together: the agentic workflow agent and the workflow infrastructure beneath it.",
        siteName: "Aflow",
      },
      accessibility: {
        primaryNavigation: "Primary navigation",
        languageSelector: "Select language",
        themeSelector: "Select theme",
        skipToContent: "Skip to content",
        mobileMenuOpen: "Open navigation menu",
        mobileMenuClose: "Close navigation menu",
        previewSummary: "Aflow workflow map with Intake, Research, Optimize, Review Gate, and Run nodes plus handoff and trace states.",
      },
      navigation: {
        product: "Product",
        aflowSoon: "Aflow Agent · Coming soon",
        specflow: "Specflow",
        useCases: "Use cases",
        technical: "Technical",
        docs: "Docs",
        download: "Download",
        github: "GitHub",
        primaryCta: "Download",
      },
      hero: {
        badge: "Agentic Workflow Agent",
        title: "Give agents a workflow to live in.",
        body: "Aflow Agent is built on Specflow. It is not another chat window; it is a workflow-native agent that helps teams design, run, maintain, and improve durable agent processes. Workflows give it bones, feedback gives it memory, and domain agents give it judgment.",
        primaryCta: "Download Aflow",
        secondaryCta: "Explore use cases",
        supportLine: "Built on Specflow · Workflow-native agent · Human gates · Persistent sessions · Workflow as Code",
        monoLabel: "Specflow gives the workflow foundation. Aflow Agent learns to operate on top of it.",
      },
      preview: {
        eyebrow: "agentic workflow",
        title: "Aflow operating on Specflow",
        startRun: "run workflow",
        caption: "The process no longer vanishes inside a chat. Every step has a role, every handoff has a shape, every judgment leaves a trace.",
        nodes: [
          ["01", "Intake", "agent: aflow-planner", "done"],
          ["02", "Research", "session: persisted", "running"],
          ["03", "Optimize", "prompt + branch update", "ready"],
          ["G1", "Review Gate", "human approval", "waiting"],
          ["04", "Run", "specflow workflow", "queued"],
        ],
        trace: ["workflow drafted", "domain agent assigned", "review gate waiting"],
      },
      values: [
        {
          label: "01",
          title: "First the workflow. Then the evolution.",
          body: "Aflow Agent does not compress work into one long conversation. It places work inside Specflow nodes, gates, and handoffs so complex collaboration has a skeleton to grow on.",
        },
        {
          label: "02",
          title: "You build agents. Aflow conducts them.",
          body: "Teams focus on talent judgment, code delivery, research verification, and other domain skills; Aflow helps those skills run, review, rework, and accumulate inside stable workflows.",
        },
        {
          label: "03",
          title: "Feedback becomes the next workflow.",
          body: "When humans revise prompts, replace agents, edit branches, or add constraints, Aflow turns those traces into material for the next version of the workflow.",
        },
      ],
      useCases: {
        label: "Use cases",
        title: "Aflow is for agent work that needs order.",
        body: "Different companies will build different domain agents. Aflow gives them one shared place to work: a runnable, reviewable, evolving workflow graph.",
        items: [
          {
            title: "Executive Search",
            flow: "Role Intake -> Market Map -> Candidate Fit -> Outreach -> Human Review -> Client Brief",
            body: "A recruiting firm's edge is not the next step in the process. It is talent judgment, market mapping, outreach quality, and client trust. Aflow fixes the process so recruiting agents can sharpen the judgment.",
            stats: ["128 profiles mapped", "23 high-fit candidates", "7 shortlisted"],
          },
          {
            title: "Software Delivery",
            flow: "Requirement -> Spec -> Plan -> Code -> Test -> Review",
            body: "Requirements, specs, implementation, tests, review, and rework paths live in one graph. Code agents can move fast; the workflow stays inspectable.",
            stats: ["spec generated", "tests passed", "review approved"],
          },
          {
            title: "Research",
            flow: "Question -> Sources -> Cross-check -> Synthesis -> Review -> Report",
            body: "Split collection, verification, synthesis, and review across specialized agents. The final report carries a path, not just polish.",
            stats: ["sources checked", "claims reviewed", "report ready"],
          },
        ],
      },
      technical: {
        label: "Built on Specflow",
        title: "Aflow stands on workflow infrastructure.",
        body: "Specflow provides workflow-as-code, persistent sessions, structured handoffs, human gates, and run logs. Aflow Agent will use those capabilities to help create, optimize, and run workflows, so workflows are not only executed, but tended and improved.",
        tags: ["Workflow as Code", "Aflow Agent", "Specflow runtime", "Persistent sessions", "Human review gates"],
        command: ["$ aflow run hiring-pipeline.yaml", "✓ workflow inspected", "✓ agent handoff refined", "⧗ human gate: shortlist review"],
      },
      closing: {
        title: "Make every agent collaboration something the organization can run again.",
        body: "Do not hide process inside prompts. Give it a shape. Aflow Agent works on that shape: designing it, running it, maintaining it, and helping it improve with the business.",
        primaryCta: "Download Aflow",
        secondaryCta: "View technical layer",
      },
      products: {
        label: "Products",
        title: "Aflow Agent and Specflow are two layers of the same idea.",
        body: "Specflow is workflow infrastructure. Aflow Agent is the agentic workflow agent built on top of it: one gives the runnable skeleton, the other helps operate and improve it.",
        aflowTitle: "Aflow Agent",
        aflowStatus: "Coming soon",
        aflowBody: "A workflow-native agent that will help teams build Specflow workflows, maintain prompts and branches, watch run feedback, and turn experience into the next workflow revision.",
        specflowTitle: "Specflow",
        specflowStatus: "Available foundation",
        specflowBody: "Workflow-as-code infrastructure for agent work: visual graphs, nodes, gates, cross-session context, run logs, and reviewable process definitions.",
        specflowPoints: ["Workflow as Code", "Agent handoffs", "Human gates", "Persistent sessions", "Run traces"],
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
        body: "Read tutorials for Aflow Agent and Specflow. The left sidebar is grouped by public docs directory; future documentation sections will appear here automatically.",
        loading: "Loading docs...",
        error: "Could not load this document.",
        noDocs: "No docs are available for this language yet.",
        sections: "Documentation",
        onThisPage: "On this page",
        updatedAt: "Updated",
        openSource: "View Markdown",
      },
      footer: {
        descriptor: "Agentic Workflow Agent built on Specflow.",
        note: "Specflow gives the workflow foundation. Aflow Agent learns to operate on top of it.",
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
    return `<div class="product-menu"><button type="button" aria-haspopup="true">${t.navigation.product}${icon("chevron")}</button><div class="product-menu-panel"><span class="product-menu-item is-disabled"><strong>Aflow Agent</strong><em>${t.navigation.aflowSoon}</em></span><a class="product-menu-item" href="product.html"><strong>Specflow</strong><em>${t.navigation.specflow}</em></a></div></div>`;
  }

  function header(t) {
    const menuLabel = menuOpen ? t.accessibility.mobileMenuClose : t.accessibility.mobileMenuOpen;
    return `<header class="site-header" data-header><div class="container header-inner"><a class="brand" href="index.html#hero" aria-label="Aflow">${brandMark()}<span>Aflow</span></a><button class="menu-trigger" type="button" data-menu-toggle aria-label="${menuLabel}" aria-expanded="${menuOpen}" aria-controls="primary-menu"><span></span><span></span></button><nav id="primary-menu" class="primary-nav ${menuOpen ? "is-open" : ""}" aria-label="${t.accessibility.primaryNavigation}">${productMenu(t)}<a href="${pageHref("#use-cases")}">${t.navigation.useCases}</a><a href="${pageHref("#technical")}">${t.navigation.technical}</a><a href="docs.html">${t.navigation.docs}</a><a href="download.html">${t.navigation.download}</a><a href="${RELEASES_URL}" target="_blank" rel="noreferrer">${t.navigation.github}</a></nav><div class="header-actions">${themeSwitcher(t)}${languageSwitcher(t)}<a class="button primary header-cta" href="download.html">${icon("arrow")}<span>${t.navigation.primaryCta}</span></a></div></div></header>`;
  }

  function workflowPreview(t) {
    const nodes = t.preview.nodes.map(([id, title, meta, state], index) => `<article class="neo-node neo-node-${index + 1} ${state}"><span>${id}</span><strong>${title}</strong><code>${meta}</code><em>${state}</em></article>`).join("");
    const trace = t.preview.trace.map((line) => `<p><span>✓</span>${line}</p>`).join("");
    return `<figure class="workflow-preview preview" aria-describedby="preview-summary preview-caption"><p id="preview-summary" class="sr-only">${t.accessibility.previewSummary}</p><div class="preview-toolbar"><div class="preview-title">${brandMark()}<div><span class="micro">${t.preview.eyebrow}</span><strong>${t.preview.title}</strong></div></div><span class="decorative-action" aria-disabled="true">${icon("play")}${t.preview.startRun}</span></div><div class="preview-canvas hero-canvas"><div class="neo-orbit" aria-hidden="true"></div><svg class="connections" viewBox="0 0 660 360" aria-hidden="true" focusable="false"><path d="M104 186 C170 86 260 86 326 150" class="connector neon animated-connector"/><path d="M332 178 C408 238 492 228 566 158" class="connector cyan animated-connector"/><path d="M352 185 C390 260 468 292 552 268" class="connector warning animated-connector"/></svg>${nodes}</div><div class="session-dock neo-trace"><div class="dock-tabs"><span class="active">Run trace</span><span>Agent sessions</span></div>${trace}</div><figcaption id="preview-caption">${t.preview.caption}</figcaption></figure>`;
  }

  function hero(t) {
    return `<section id="hero" class="hero section" aria-labelledby="hero-title"><div class="hero-orbit" aria-hidden="true">A</div><div class="container hero-layout"><div class="hero-copy reveal"><div class="product-pill">${brandMark()}<strong>Aflow</strong><span>${t.hero.badge}</span></div><h1 id="hero-title">${t.hero.title}</h1><p class="hero-body">${t.hero.body}</p><div class="cta-row"><a class="button primary" href="download.html">${icon("arrow")}<span>${t.hero.primaryCta}</span></a><a class="button secondary" href="#use-cases">${icon("branch")}<span>${t.hero.secondaryCta}</span></a></div><p class="support-line">${t.hero.supportLine}</p><p class="agent-stack">${t.hero.monoLabel}</p></div>${workflowPreview(t)}</div></section>`;
  }

  function values(t) {
    return `<section id="workflow" class="value-grid section"><div class="container values-layout">${t.values.map((item) => `<article class="value-card"><span>${item.label}</span><h2>${item.title}</h2><p>${item.body}</p></article>`).join("")}</div></section>`;
  }

  function useCases(t) {
    return `<section id="use-cases" class="use-case section" aria-labelledby="use-case-title"><div class="container"><div class="section-heading"><p class="section-label">${t.useCases.label}</p><h2 id="use-case-title">${t.useCases.title}</h2><p>${t.useCases.body}</p></div><div class="case-grid">${t.useCases.items.map((item) => `<article class="case-card"><h3>${item.title}</h3><p>${item.body}</p><code>${item.flow}</code><div>${item.stats.map((stat) => `<span>${stat}</span>`).join("")}</div></article>`).join("")}</div></div></section>`;
  }

  function technical(t) {
    return `<section id="technical" class="architecture section" aria-labelledby="technical-title"><div class="container architecture-layout"><div><p class="section-label">${t.technical.label}</p><h2 id="technical-title">${t.technical.title}</h2><p>${t.technical.body}</p><div class="technical-stack">${t.technical.tags.map((tag) => `<span>${tag}</span>`).join("")}</div></div><pre class="command-card" aria-label="Aflow command example">${t.technical.command.map((line) => `<code>${line}</code>`).join("")}</pre></div></section>`;
  }

  function closing(t) {
    return `<section id="closing" class="closing section" aria-labelledby="closing-title"><div class="container closing-card"><h2 id="closing-title">${t.closing.title}</h2><p>${t.closing.body}</p><div class="cta-row"><a class="button primary" href="download.html">${icon("arrow")}<span>${t.closing.primaryCta}</span></a><a class="button secondary" href="#technical">${icon("terminal")}<span>${t.closing.secondaryCta}</span></a></div></div></section>`;
  }

  function productsPage(t) {
    const points = t.products.specflowPoints.map((point) => `<span>${point}</span>`).join("");
    return `<main id="main-content" class="products-page" tabindex="-1"><section class="products-hero section"><div class="container"><p class="section-label">${t.products.label}</p><h1>${t.products.title}</h1><p>${t.products.body}</p></div></section><section class="products-section section"><div class="container product-grid"><article class="product-card coming-soon"><span>${t.products.aflowStatus}</span><h2>${t.products.aflowTitle}</h2><p>${t.products.aflowBody}</p></article><article class="product-card"><span>${t.products.specflowStatus}</span><h2>${t.products.specflowTitle}</h2><p>${t.products.specflowBody}</p><div class="technical-stack">${points}</div></article></div><div class="container product-cta"><a class="button primary" href="download.html">${icon("arrow")}<span>${t.products.cta}</span></a></div></section></main>`;
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
          : `<main id="main-content" tabindex="-1">${hero(t)}${values(t)}${useCases(t)}${technical(t)}${closing(t)}</main>`;
    app.innerHTML = `<a class="skip-link" href="#main-content">${t.accessibility.skipToContent}</a>${header(t)}${main}${footer(t)}`;
    bindControls();
    app.querySelector("[data-header]")?.classList.toggle("has-scroll", window.scrollY > 8);
    if (page === "docs") loadDocs();
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
