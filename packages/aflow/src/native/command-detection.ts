import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export async function commandExists(command: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!command) return false;
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return isExecutable(command);
  }

  const pathEntries = (env["PATH"] ?? "").split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (env["PATHEXT"] ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  for (const directory of pathEntries) {
    for (const extension of extensions) {
      if (await isExecutable(join(directory, `${command}${extension.toLowerCase()}`))) return true;
      if (extension && await isExecutable(join(directory, `${command}${extension.toUpperCase()}`))) return true;
    }
  }
  return false;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
