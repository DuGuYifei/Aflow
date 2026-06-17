export interface SpecflowLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export type SpecflowLoggerOption = SpecflowLogger | false;

const noopLogger: SpecflowLogger = {
  log() {},
  warn() {},
  error() {},
};

export function resolveSpecflowLogger(logger?: SpecflowLoggerOption): SpecflowLogger {
  if (logger === false) return noopLogger;
  return logger ?? console;
}
