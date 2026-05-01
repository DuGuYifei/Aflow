// import.meta.glob is a Bun bundler transform (resolved at bun build time).
// At runtime under `bun run` it returns {} — serveStaticUi is never called
// in dev mode so that is fine.
declare interface ImportMeta {
  glob<T = unknown>(
    pattern: string,
    options?: { as?: string; eager?: boolean },
  ): Record<string, T>;
}
