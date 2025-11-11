# Repository Guidelines

## Project Structure & Module Organization
- Monorepo managed by `pnpm-workspace.yaml`; applications live under `apps/`, background workers under `workers/`, and infra tooling will later land in `infra/`.
- `apps/web` is the Vite + React canvas shell (see `src/` for UI, `public/` for static assets).
- `apps/api` hosts the NestJS backend; HTTP, WebSocket, and Prisma code sits in `src/`, with tests in `test/`.
- `workers/tiler` contains the asset tiler (Sharp + S3 helpers in `src/index.ts`).
- `scrapbook_app_plan.md` captures long-term scope—consult it before proposing architecture changes.

## Dependency Installs
- **Windows owns installs.** Only run `pnpm install`, `pnpm add`, or other dependency-mutating commands from Windows CMD/PowerShell so the `node_modules` tree stays tied to the same pnpm store.
- Inside WSL/Linux we should run scripts only (dev/lint/test/build). If a script needs new packages or a reinstall, ping the user to execute it from Windows.

## Build, Test, and Development Commands
- `pnpm dev` — launches every package’s `dev` script (Vite, Nest watcher, tiler stub).
- `pnpm build` — type-checks and emits production artifacts for all packages.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — run linting, TypeScript checks, and Jest/unit suites across the workspace.
- Targeted work: `pnpm --filter apps/web dev`, `pnpm --filter apps/api test`, etc.

## Coding Style & Naming Conventions
- TypeScript everywhere; prefer ES2022+ modules and `async/await`.
- Follow the default ESLint configs (`apps/web/eslint.config.js`, `apps/api/eslint.config.mjs`). Stick to 2-space indentation in web, 2-space or Nest defaults in API.
- Use descriptive file names (`*.service.ts`, `*.controller.ts`, React components in `PascalCase.tsx`).
- Formatting: Prettier (via `pnpm --filter apps/api format`) for the API; Vite project follows ESLint + TypeScript rules.
- Icons: when you need UI glyphs, pull them from `lucide-react` for consistency with the existing toolbar/settings menus.

## Testing Guidelines
- API tests use Jest with `--runInBand`. Unit specs live next to source files (`*.spec.ts`).
- Frontend and tiler currently stub tests; add Vite/Vitest or worker-specific suites before shipping new features.
- Keep new tests deterministic and prefer dependency injection over global state for easier mocking.
- At the end of each milestone, run `pnpm --filter web test` (from Windows) and `pnpm --filter web typecheck` to guard against regressions.

## Commit & Pull Request Guidelines
- No formal history exists yet; adopt Conventional Commits (`feat: add camera controls`, `fix: clamp zoom bounds`).
- Each PR should describe scope, outline testing (`pnpm test`, manual steps), and link related plan sections or issues. Include screenshots or screen recordings for UI changes and note any follow-up tasks.

## Security & Configuration Tips
- Never commit `.env` or production secrets; reference `.env.example` and use placeholder values.
- When integrating with S3/Prisma, keep credentials in environment variables and prefer local Docker services for testing.
