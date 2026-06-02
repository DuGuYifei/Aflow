import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AFLOW_PACKAGE_VERSION } from "../version";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DARK_THEME = `{
  "name": "dark",
  "vars": {
    "cyan": "#00d7ff",
    "blue": "#5f87ff",
    "green": "#b5bd68",
    "red": "#cc6666",
    "yellow": "#ffff00",
    "text": "#d4d4d4",
    "gray": "#808080",
    "dimGray": "#666666",
    "darkGray": "#505050",
    "accent": "#8abeb7",
    "selectedBg": "#3a3a4a",
    "userMsgBg": "#343541",
    "toolPendingBg": "#282832",
    "toolSuccessBg": "#283228",
    "toolErrorBg": "#3c2828",
    "customMsgBg": "#2d2838"
  },
  "colors": {
    "accent": "accent",
    "border": "blue",
    "borderAccent": "cyan",
    "borderMuted": "darkGray",
    "success": "green",
    "error": "red",
    "warning": "yellow",
    "muted": "gray",
    "dim": "dimGray",
    "text": "text",
    "thinkingText": "gray",
    "selectedBg": "selectedBg",
    "userMessageBg": "userMsgBg",
    "userMessageText": "text",
    "customMessageBg": "customMsgBg",
    "customMessageText": "text",
    "customMessageLabel": "#9575cd",
    "toolPendingBg": "toolPendingBg",
    "toolSuccessBg": "toolSuccessBg",
    "toolErrorBg": "toolErrorBg",
    "toolTitle": "text",
    "toolOutput": "gray",
    "mdHeading": "#f0c674",
    "mdLink": "#81a2be",
    "mdLinkUrl": "dimGray",
    "mdCode": "accent",
    "mdCodeBlock": "green",
    "mdCodeBlockBorder": "gray",
    "mdQuote": "gray",
    "mdQuoteBorder": "gray",
    "mdHr": "gray",
    "mdListBullet": "accent",
    "toolDiffAdded": "green",
    "toolDiffRemoved": "red",
    "toolDiffContext": "gray",
    "syntaxComment": "#6A9955",
    "syntaxKeyword": "#569CD6",
    "syntaxFunction": "#DCDCAA",
    "syntaxVariable": "#9CDCFE",
    "syntaxString": "#CE9178",
    "syntaxNumber": "#B5CEA8",
    "syntaxType": "#4EC9B0",
    "syntaxOperator": "#D4D4D4",
    "syntaxPunctuation": "#D4D4D4",
    "thinkingOff": "darkGray",
    "thinkingMinimal": "#6e6e6e",
    "thinkingLow": "#5f87af",
    "thinkingMedium": "#81a2be",
    "thinkingHigh": "#b294bb",
    "thinkingXhigh": "#d183e8",
    "bashMode": "green"
  },
  "export": {
    "pageBg": "#18181e",
    "cardBg": "#1e1e24",
    "infoBg": "#3c3728"
  }
}`;

const LIGHT_THEME = `{
  "name": "light",
  "vars": {
    "teal": "#5a8080",
    "blue": "#547da7",
    "green": "#588458",
    "red": "#aa5555",
    "yellow": "#9a7326",
    "text": "#1f2328",
    "mediumGray": "#6c6c6c",
    "dimGray": "#767676",
    "lightGray": "#b0b0b0",
    "selectedBg": "#d0d0e0",
    "userMsgBg": "#e8e8e8",
    "toolPendingBg": "#e8e8f0",
    "toolSuccessBg": "#e8f0e8",
    "toolErrorBg": "#f0e8e8",
    "customMsgBg": "#ede7f6"
  },
  "colors": {
    "accent": "teal",
    "border": "blue",
    "borderAccent": "teal",
    "borderMuted": "lightGray",
    "success": "green",
    "error": "red",
    "warning": "yellow",
    "muted": "mediumGray",
    "dim": "dimGray",
    "text": "text",
    "thinkingText": "mediumGray",
    "selectedBg": "selectedBg",
    "userMessageBg": "userMsgBg",
    "userMessageText": "text",
    "customMessageBg": "customMsgBg",
    "customMessageText": "text",
    "customMessageLabel": "#7e57c2",
    "toolPendingBg": "toolPendingBg",
    "toolSuccessBg": "toolSuccessBg",
    "toolErrorBg": "toolErrorBg",
    "toolTitle": "text",
    "toolOutput": "mediumGray",
    "mdHeading": "yellow",
    "mdLink": "blue",
    "mdLinkUrl": "dimGray",
    "mdCode": "teal",
    "mdCodeBlock": "green",
    "mdCodeBlockBorder": "mediumGray",
    "mdQuote": "mediumGray",
    "mdQuoteBorder": "mediumGray",
    "mdHr": "mediumGray",
    "mdListBullet": "green",
    "toolDiffAdded": "green",
    "toolDiffRemoved": "red",
    "toolDiffContext": "mediumGray",
    "syntaxComment": "#008000",
    "syntaxKeyword": "#0000FF",
    "syntaxFunction": "#795E26",
    "syntaxVariable": "#001080",
    "syntaxString": "#A31515",
    "syntaxNumber": "#098658",
    "syntaxType": "#267F99",
    "syntaxOperator": "#000000",
    "syntaxPunctuation": "#000000",
    "thinkingOff": "lightGray",
    "thinkingMinimal": "#767676",
    "thinkingLow": "blue",
    "thinkingMedium": "teal",
    "thinkingHigh": "#875f87",
    "thinkingXhigh": "#8b008b",
    "bashMode": "green"
  },
  "export": {
    "pageBg": "#f8f8f8",
    "cardBg": "#ffffff",
    "infoBg": "#fffae6"
  }
}`;

export function prepareAflowRuntimePackage(): void {
  const runtimeDir = getRuntimePackageDir();
  mkdirSync(runtimeDir, { recursive: true });
  writeIfChanged(join(runtimeDir, "package.json"), runtimePackageJson());
  writeIfChanged(join(runtimeDir, "README.md"), "Aflow is a Specflow workflow-building agent powered by Pi.\n");
  writeIfChanged(join(runtimeDir, "CHANGELOG.md"), "");

  writeBuiltInThemes(runtimeDir);

  mkdirSync(join(runtimeDir, "docs"), { recursive: true });
  mkdirSync(join(runtimeDir, "examples"), { recursive: true });
  mkdirSync(join(runtimeDir, "assets"), { recursive: true });
  copyInteractiveAssetsIfAvailable(runtimeDir);
  copyExportAssetsIfAvailable(runtimeDir);

  process.env["PI_PACKAGE_DIR"] = runtimeDir;
  process.env["PI_SKIP_VERSION_CHECK"] ??= "1";
  process.env["PI_CODING_AGENT"] = "true";
}

export function getAflowVersion(): string {
  return process.env["AFLOW_VERSION"]
    ?? readPackageVersionFromSource()
    ?? readPackageVersionFromExecutableDir()
    ?? AFLOW_PACKAGE_VERSION;
}

function getRuntimePackageDir(): string {
  const explicit = process.env["AFLOW_PI_PACKAGE_DIR"];
  if (explicit) return resolve(explicit);

  return join(homedir(), ".aflow", "runtime", "pi-package");
}

function runtimePackageJson(): string {
  return `${JSON.stringify({
    name: "@specflow/aflow",
    version: getAflowVersion(),
    type: "module",
    piConfig: {
      name: "aflow",
      configDir: ".aflow",
    },
  }, null, 2)}\n`;
}

function writeBuiltInThemes(runtimeDir: string): void {
  for (const themeDir of [
    join(runtimeDir, "theme"),
    join(runtimeDir, "dist", "modes", "interactive", "theme"),
  ]) {
    mkdirSync(themeDir, { recursive: true });
    writeIfChanged(join(themeDir, "dark.json"), DARK_THEME);
    writeIfChanged(join(themeDir, "light.json"), LIGHT_THEME);
  }
}

function readPackageVersionFromSource(): string | undefined {
  const packageJsonPath = join(__dirname, "..", "..", "package.json");
  return readPackageVersion(packageJsonPath);
}

function readPackageVersionFromExecutableDir(): string | undefined {
  if (!process.execPath) return undefined;
  return readPackageVersion(join(dirname(process.execPath), "package.json"));
}

function readPackageVersion(packageJsonPath: string): string | undefined {
  if (!existsSync(packageJsonPath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof raw.version === "string" ? raw.version : undefined;
  } catch {
    return undefined;
  }
}

function copyExportAssetsIfAvailable(runtimeDir: string): void {
  const exportDir = findPiExportAssetsDir();
  if (!exportDir) return;

  for (const targetDir of [
    join(runtimeDir, "export-html"),
    join(runtimeDir, "dist", "core", "export-html"),
  ]) {
    const targetVendorDir = join(targetDir, "vendor");
    mkdirSync(targetVendorDir, { recursive: true });
    for (const name of ["template.html", "template.css", "template.js"]) {
      copyIfExists(join(exportDir, name), join(targetDir, name));
    }
    for (const name of ["highlight.min.js", "marked.min.js"]) {
      copyIfExists(join(exportDir, "vendor", name), join(targetVendorDir, name));
    }
  }
}

function copyInteractiveAssetsIfAvailable(runtimeDir: string): void {
  const assetsDir = findPiInteractiveAssetsDir();
  if (!assetsDir) return;

  for (const targetDir of [
    join(runtimeDir, "assets"),
    join(runtimeDir, "dist", "modes", "interactive", "assets"),
  ]) {
    mkdirSync(targetDir, { recursive: true });
    for (const name of readdirSync(assetsDir)) {
      copyIfExists(join(assetsDir, name), join(targetDir, name));
    }
  }
}

function findPiExportAssetsDir(): string | undefined {
  for (const base of findAncestorDirs(__dirname)) {
    const candidate = join(base, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "export-html");
    if (existsSync(join(candidate, "template.html"))) return candidate;
  }
  return undefined;
}

function findPiInteractiveAssetsDir(): string | undefined {
  for (const base of findAncestorDirs(__dirname)) {
    const candidate = join(base, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "modes", "interactive", "assets");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function findAncestorDirs(start: string): string[] {
  const dirs: string[] = [];
  let current = start;
  while (true) {
    dirs.push(current);
    const parent = dirname(current);
    if (parent === current) return dirs;
    current = parent;
  }
}

function copyIfExists(source: string, target: string): void {
  if (!existsSync(source)) return;
  writeIfChanged(target, readFileSync(source, "utf8"));
}

function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return;
  writeFileSync(path, content);
}
