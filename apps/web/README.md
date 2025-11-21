# Scrapbook – Web Canvas

This package hosts the Vite + React shell for the Scrapbook canvas. The renderer is now a custom SVG stage that handles the viewport math, grid/origin overlays, and interaction layer entirely in React/TypeScript.

## Development

```bash
pnpm install
pnpm dev
```

Useful workspace commands:

- `pnpm --filter web typecheck` – reassure TypeScript.
- `pnpm --filter web test` – (stubs for now) Vitest runner.
- `pnpm --filter web build` – emits the production bundle.

## Font Pipelines

We ship a single vector font pipeline:

| Command | Purpose |
| --- | --- |
| `pnpm --filter web generate:vector-fonts` | Builds the JSON glyph data that powers SVG text layout, underline geometry, and measurement. |

The command expects the Inter TTFs in `apps/web/public/fonts/`. Generated assets are written under `public/vector-fonts` and checked into the repo so runtime loads stay static.
