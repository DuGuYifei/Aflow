# Conventions

Last updated: 2026-06-02

## Language and runtime

- TypeScript everywhere. No JavaScript source files.
- Bun as the runtime and bundler. Version is pinned in `.mise.toml`.
- All packages set `"type": "module"` and `"moduleResolution": "Bundler"`.

## Package structure

- Each package exports only from `src/index.ts`. No deep imports across package boundaries.
- Internal modules within a package are not re-exported unless explicitly needed by consumers.
- Shared constants live in `@specflow/shared`. No package defines its own duplicate constants.
- `packages/aflow` uses `@earendil-works/pi-coding-agent` as its SDK dependency and keeps all Pi-facing calls in a package-local adapter layer.

## Naming

- Files: `kebab-case.ts`
- Types and interfaces: `PascalCase`
- Functions and variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`

## Code style

- No comments explaining what code does — names should be self-explanatory.
- Do not use unclear abbreviations in identifiers. Prefer complete, readable names for variables, parameters, functions, and types so the purpose is obvious at a glance. Common domain or protocol terms such as `id`, `URL`, `HTTP`, `API`, `ACP`, and `JSON` are allowed.
- Comments only for non-obvious constraints, invariants, or workarounds.
- No error handling for impossible scenarios. Validate only at system boundaries.
- No feature flags or backwards-compatibility shims — change the code directly.

## Git commits

- Use a Conventional Commits prefix: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`, `perf:`, `build:`, `ci:`, or `revert:`.
- A short scope keyword may be added between the prefix and the colon when it helps readers understand the commit quickly, for example `feat(auth): add terminal login` or `fix(canvas): preserve branch labels`.
- Keep the scope optional, lowercase, concise, and focused on the primary area or intent of the commit.

## Workflow domain

- `WorkflowNode` and `WorkflowEdge` are discriminated unions of concrete graph types.
- `Workflow` owns the graph directly (`nodes`, `edges`). There is no separate `WorkflowGraph` wrapper.
- Nodes use `kind` as the discriminator. Agent nodes and functional nodes do not share agent-only fields.
- Edges use `kind` as the discriminator. Passthrough edges forward content unchanged; tagged-output edges bind content into prompt variables.
