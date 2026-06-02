export function splitCommandArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += "\\";
  if (current) args.push(current);
  return args;
}

export interface CommonCommandOptions {
  serverUrl?: string;
  rest: string[];
}

export function parseCommonCommandOptions(args: string[]): CommonCommandOptions {
  const rest: string[] = [];
  let serverUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--server") {
      serverUrl = requiredValue(args[++index], "--server");
      continue;
    }
    if (argument.startsWith("--server=")) {
      serverUrl = argument.slice("--server=".length);
      continue;
    }
    rest.push(argument);
  }

  return { serverUrl, rest };
}

export function parseDefineArgs(args: string[]): { values: Record<string, string>; rest: string[] } {
  const values: Record<string, string> = {};
  const rest: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-D") {
      assignDefine(values, requiredValue(args[++index], "-D"));
      continue;
    }
    if (argument.startsWith("-D")) {
      assignDefine(values, argument.slice(2));
      continue;
    }
    rest.push(argument);
  }

  return { values, rest };
}

export function requiredValue(value: string | undefined, option: string): string {
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}

function assignDefine(values: Record<string, string>, rawValue: string): void {
  const separator = rawValue.indexOf("=");
  if (separator <= 0) throw new Error(`Expected -Dname=value, got -D${rawValue}`);
  values[rawValue.slice(0, separator)] = rawValue.slice(separator + 1);
}
