# Scrapbook

Full-page SVG infinite canvas with NestJS backend and Sharp tiler, built as a pnpm monorepo. Current stack is React 19 + Vite 7, Zustand store, SVG renderer (no Pixi). Backend is Nest 11 + Prisma 6 + Postgres + S3-compatible storage. Assets are tiled by a worker for smooth zooming.

## Current status (Nov 2025)
- M0–M7 complete: scaffold, camera/render (SVG), selection, transforms, assets+tiling, shapes, text, project persistence (API + IndexedDB).
- In progress next: **M8 Auth + project entry/share** with substeps (auth shell, project list, canvas entry/exit overlay, view-only mode, share dialog).
- Upcoming: M9 Collaboration (Yjs), M10 PWA/offline, M11 Hardening, M12 Mobile polish.

## Repo layout
- `apps/web` – Vite/React app, SVGStage renderer, toolbar, scene store, autosave, project persistence hooks.
- `apps/api` – NestJS HTTP API + Prisma models; endpoints for projects, assets, tiles; storage abstraction (S3 or local filesystem fallback).
- `workers/tiler` – Sharp-based tiling/variant generator processing `asset.process` operations.
- `infra/` – reserved for future Terraform/K8s.
- Root scripts: `pnpm dev/build/test/lint/typecheck` run across workspaces.

## Quick start (local dev)
1. Prereqs: Node 24, pnpm 9 (`corepack enable`).
2. Install deps: `pnpm install` (or `pnpm -w install --frozen-lockfile`).
3. Start dev: `pnpm dev` (runs Vite on 5173, API on 3000, tiler stub). Vite proxies `/projects`, `/assets`, `/tiles` to the API.
4. Visit http://localhost:5173 – autosaves a project via the API and IndexedDB.

## Quick start (Docker stack)
1. `cp .env.example .env` (optional; compose passes defaults).
2. `docker compose up -d --build` (services: db, minio, api, web, tiler).
3. Apply schema once: `docker compose exec api npx prisma db push`.
4. Open web: http://localhost:8080. API: http://localhost:3000. MinIO console: http://localhost:9001 (minio/minio12345).

## Environment
- API expects `DATABASE_URL`, `S3_*` (or falls back to local storage directory), and now `AUTH_JWT_SECRET`/`AUTH_JWT_EXPIRES` for JWT auth. You can seed a default admin with `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` (defaults in `.env`). See `.env.example`.
- Web uses `VITE_API_PROXY_TARGET` (defaults to http://localhost:3000) for dev proxy; nginx already proxies in the docker image.

## Running tests & checks
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck` (or per package: `pnpm --filter web typecheck`, `pnpm --filter api typecheck`)
- Tests: `pnpm test` (API uses Jest `--runInBand`; web has Vitest config scaffolded)
- Build: `pnpm build`

## Key features
- SVGStage renderer: grid, origin, selection/marquee, drag/scale/rotate handles with precision-clamped zoom limits from `canvas/viewport/zoomLimits.ts`.
- Scene store (Zustand): shapes (rect/ellipse/polygon), images with tiled LOD, vector text via custom `public/vector-fonts` manifest; undo/redo history; z-order tools; locking; autosave to API + IndexedDB.
- Assets: upload images to API, Sharp tiler generates AVIF/WEBP variants and 256px tiles stored in S3/MinIO/local; tiles served via `/tiles/:assetId/:z/:x/:y`.
- Persistence: project create/fetch/update endpoints; frontend autosaves with debounce and local cache for offline fallback.
- Sharing (planned M8): auth pages, project list, full-page canvas routes `/projects/:id`, view-only `/view/:token`, share dialog to mint/revoke tokens, non-intrusive “Back to canvases” overlay.

## API overview (implemented)
- `POST /projects`, `GET /projects/:id`, `PATCH /projects/:id`
- `POST /assets` (image upload, enqueues tiling), `GET /assets/:id/meta`
- `GET /assets/:id/variant/:format` (AVIF/WEBP), `GET /tiles/:assetId/:z/:x/:y`
- `GET /health`

## Storage behavior
- If S3 env vars are set, objects are stored in S3/MinIO with bucket auto-creation; otherwise files are written under `storage/` (configurable via `ASSET_STORAGE_DIR`).

## Developing the web app
- Full-page canvas is the default view; keep UI overlays minimal. To exit back to list, an overlay button will be added during M8.
- Dev proxy paths: `/projects`, `/assets`, `/tiles` → API (configured in `apps/web/vite.config.ts`).

## Contributing workflow
- Use 2-space TS formatting (web) and Prettier for API (`pnpm --filter api format`).
- Prefer lucide-react icons for UI glyphs.
- Follow milestone plan in `scrapbook_app_plan.md`; cite the Camera Precision Reference when changing zoom limits.

## Milestone tracking
- See `scrapbook_app_plan.md` for detailed milestones and sub-milestones (Auth/share is M8 with M8.1–M8.5 steps). This README captures the current architecture snapshot; the plan file holds the forward-looking breakdown.
