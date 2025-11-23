# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scrapbook is a full-page SVG infinite canvas application with a NestJS backend and Sharp-based image tiler. Built as a pnpm monorepo targeting desktop, tablet, and mobile (Chrome, Safari, Firefox; iOS/iPadOS 16+, Android 11+).

**Current Status (Nov 2025):** M0–M7 complete (scaffold, camera/render, selection, transforms, assets+tiling, shapes, text, persistence). In progress: M8 Auth + project entry/share.

**Tech Stack:**
- Frontend: React 19 + Vite 7, Zustand store, SVG renderer (no Pixi), TanStack Query, gl-matrix, rbush
- Backend: NestJS 11 + Prisma 6 + PostgreSQL 18 + S3-compatible storage
- Asset Processing: Sharp 0.34.5 for image tiling (workers/tiler)
- Collaboration: Yjs 13.6.26 + y-websocket (planned M9)

## Repository Structure

```
scrapbook/                     # pnpm workspace root
├── apps/
│   ├── web/                   # Vite/React canvas app
│   │   ├── src/
│   │   │   ├── canvas/        # SVGStage renderer, camera, viewport, text
│   │   │   ├── state/         # Zustand stores (scene, auth, dialog, projectCache, toast)
│   │   │   ├── hooks/         # useProjectPersistence, useCollaboration, useAuthBootstrap
│   │   │   ├── pages/         # Route components
│   │   │   ├── ui/            # Reusable UI components
│   │   │   ├── tiles/         # Image tile loading/caching
│   │   │   └── api/           # API client functions
│   │   └── public/
│   │       ├── vector-fonts/  # Custom vector font JSON assets for <text> rendering
│   │       └── fonts/         # Web fonts
│   └── api/                   # NestJS backend
│       ├── src/
│       │   ├── auth/          # JWT authentication, guards, strategies
│       │   ├── users/         # User management
│       │   ├── projects/      # Project CRUD + scene persistence
│       │   ├── assets/        # Image upload, metadata, tile serving
│       │   ├── collab/        # WebSocket gateway for Yjs collaboration
│       │   ├── storage/       # S3/local filesystem abstraction
│       │   └── prisma/        # Database client setup
│       └── prisma/
│           └── schema.prisma  # Prisma models: User, Project, Asset, ShareToken, etc.
└── workers/
    └── tiler/                 # Sharp-based image processing worker
        └── src/
            ├── index.ts       # Tiling worker entry
            └── storage.ts     # S3 upload helpers
```

## Common Development Commands

### Root Commands (run from workspace root)
```bash
pnpm dev          # Start all services in parallel (Vite on :5173, API on :3000, tiler)
pnpm build        # Build all packages
pnpm test         # Run all test suites
pnpm lint         # Lint all packages
pnpm typecheck    # TypeScript check all packages
```

### Targeted Package Commands
```bash
pnpm --filter web dev              # Start only web dev server
pnpm --filter api dev              # Start only API in watch mode
pnpm --filter web typecheck        # Typecheck web package
pnpm --filter api test             # Run API tests (Jest --runInBand)
pnpm --filter api format           # Format API with Prettier
```

### Database Operations
```bash
pnpm prisma:generate               # Generate Prisma client
pnpm prisma:push:local             # Push schema to local database
npx prisma db push                 # Push schema (from apps/api/)
npx prisma studio                  # Open Prisma Studio (from apps/api/)
```

### Docker Stack
```bash
docker compose up -d --build       # Start all services (db, minio, api, web, tiler)
docker compose exec api npx prisma db push  # Apply schema in container
docker compose logs -f --tail=200  # Follow logs
```

Services: db (Postgres :5432), minio (S3 :9000, console :9001), api (:3000), web (:8080), tiler (background)

### Web Development
```bash
cd apps/web
pnpm dev                           # Start Vite dev server
pnpm build                         # Production build
pnpm test                          # Run Vitest tests
pnpm generate:vector-fonts         # Regenerate vector font manifests
```

## Architecture & Key Concepts

### Rendering: SVG-Based Canvas
- **SVGStage** (`apps/web/src/canvas/SVGStage.tsx`): Main renderer using native SVG/DOM elements
  - Layered `<g>` elements for nodes, overlays, hit regions
  - Custom pointer/touch handlers for infinite pan/zoom
  - No Pixi/WebGL runtime; all rendering via SVG primitives
  - Image tiles inserted as `<image>` elements with LOD switching
  - Text rendered via `<text>` using vector fonts from `public/vector-fonts`

### Camera & Viewport Precision
- **Zoom limits** defined in `apps/web/src/canvas/viewport/zoomLimits.ts`:
  - `MIN_VIEWPORT_SCALE` (≈1.45e-11) and `MAX_VIEWPORT_SCALE` (≈4.03e10)
  - Computed to keep float precision within 0.25px for 100k-sized coordinates
  - ALWAYS reference these constants; never hardcode zoom bounds
  - Tests in `zoomLimits.spec.ts` validate precision assumptions
- Infinite pan via unbounded world coordinates; zoom clamped to safe window
- Custom pointer handlers in SVGStage manage gestures without Pixi's viewport

### Scene State Management (Zustand)
- **scene.ts** (`apps/web/src/state/scene.ts`): Primary scene store
  - Nodes: shapes (rect/ellipse/polygon), images with tiled LOD, vector text
  - Transform matrix per node (gl-matrix Mat3), worldAABB for culling
  - Undo/redo with command pattern and snapshots
  - Z-order tools, locking, visibility
  - Autosave debounced to API + IndexedDB
- **auth.ts**: User session, JWT token, login/logout
- **projectCache.ts**: Local IndexedDB cache for offline fallback
- **dialog.ts**: Modal/dialog state
- **toast.ts**: Notification state

### Asset Pipeline & Tiling
1. User uploads image → `POST /assets` (apps/api/src/assets/)
2. API stores original in S3/local, creates Asset record (status: PENDING)
3. API enqueues tiling operation → `workers/tiler` processes with Sharp
4. Tiler generates:
   - AVIF/WEBP variants
   - 256px tiles at multiple zoom levels (z/x/y)
   - Stores tiles in S3/MinIO/local, updates Asset status to READY
5. Frontend fetches tiles via `GET /tiles/:assetId/:z/:x/:y`
6. LOD switching in canvas based on current viewport zoom

### Storage Abstraction
- `apps/api/src/storage/`: S3-compatible or local filesystem
- If `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` set → S3/MinIO
- Otherwise → writes to `storage/` directory (configurable via `ASSET_STORAGE_DIR`)
- Bucket auto-creation on startup

### API Endpoints
```
POST   /auth/signup              # Create user account
POST   /auth/login               # Login, returns JWT
GET    /auth/me                  # Get current user

GET    /projects                 # List user's projects
POST   /projects                 # Create new project
GET    /projects/:id             # Fetch project by ID
PATCH  /projects/:id             # Update project scene/name

POST   /assets                   # Upload image (multipart/form-data)
GET    /assets/:id/meta          # Get asset metadata
GET    /assets/:id/variant/:fmt  # Get AVIF/WEBP variant
GET    /tiles/:assetId/:z/:x/:y  # Get tile image

GET    /health                   # Health check

WS     /collab/:projectId        # Yjs collaboration WebSocket (planned M9)
```

### Persistence Strategy
- **Autosave**: Scene changes debounced to `PATCH /projects/:id` + IndexedDB
- **Offline fallback**: IndexedDB cache used when network unavailable (PWA M10)
- **Conflict resolution**: TBD in M9 (Yjs CRDT for collaboration)

### Authentication & Authorization
- JWT-based auth (bcryptjs hashing, passport-jwt strategy)
- Guards in API: `@UseGuards(JwtAuthGuard)` on protected routes
- Frontend: `useAuthBootstrap` hook fetches `/auth/me` on mount, stores in auth store
- Default admin seeded via `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` env vars

### Collaboration Architecture (M9 - Planned)
- Yjs `Y.Map`, `Y.Array`, `Y.Text` for CRDT-based scene sync
- y-websocket gateway in NestJS (`apps/api/src/collab/`)
- Awareness API for remote cursors/selections
- Frontend: `useCollaboration` hook connects to `/collab/:projectId`

## Development Guidelines

### Coding Style
- TypeScript everywhere (ES2022+, `async/await`)
- 2-space indentation (web + API)
- Use `lucide-react` for UI icons
- Follow ESLint configs in each package
- API: Use Prettier (`pnpm --filter api format`)

### Camera/Viewport Changes
- ALWAYS reference `MIN_VIEWPORT_SCALE` / `MAX_VIEWPORT_SCALE` from `zoomLimits.ts`
- Never hardcode zoom bounds
- Rerun `apps/web/src/canvas/viewport/zoomLimits.spec.ts` if changing tolerance

### Testing
- API: Jest with `--runInBand`, unit specs next to source (`*.spec.ts`)
- Web: Vitest (run `pnpm --filter web test`)
- Add deterministic tests, prefer dependency injection for mocks
- Run `pnpm typecheck` and `pnpm test` before committing

### Milestone Planning
- Reference `scrapbook_app_plan.md` for detailed milestone breakdown
- Current: M8 Auth + project entry/share (M8.1-M8.5 sub-milestones)
- Upcoming: M9 Collaboration (Yjs), M10 PWA/offline, M11 Hardening, M12 Mobile polish

### UI Patterns
- Full-page canvas is the default view; keep overlays minimal
- Non-intrusive "Back to canvases" overlay for navigation
- View-only mode (`/view/:token`): disable mutations, show slim banner
- Use Zustand stores for global state, TanStack Query for server state

### API Development
- Use NestJS modules, controllers, services pattern
- DTOs with `class-validator` for input validation
- Prisma for database access (never raw SQL)
- Use storage abstraction layer for S3/local operations
- Follow `*.module.ts`, `*.controller.ts`, `*.service.ts` naming

### Vector Fonts
- Custom vector fonts in `apps/web/public/vector-fonts/`
- Generate via `pnpm --filter web generate:vector-fonts`
- Text rendered as SVG `<text>` elements (stays sharp at all zooms)

### Environment Variables
- Never commit `.env` or production secrets
- Reference `.env.example` for required variables
- API expects: `DATABASE_URL`, `S3_*` (optional), `AUTH_JWT_SECRET`, `AUTH_JWT_EXPIRES`
- Web uses: `VITE_API_PROXY_TARGET` (defaults to http://localhost:3000)

### Vite Proxy Configuration
Dev server proxies:
- `/api/*` → API server (rewrite to remove `/api` prefix)
- `/collab/*` → API WebSocket server (with `ws: true`)

### Performance Targets
- 60 fps target, allow 30 fps minimum on mid-tier phones
- Memory: ~256 MB GPU textures mobile, ~1 GB desktop
- Cap `devicePixelRatio` at 1.5 on mobile
- Scene JSON <1 MB per 1k nodes (excluding assets)

### Security
- Lock dependencies, audit on CI
- Block merges on high severity vulnerabilities
- Never include API keys, tokens in code/commits
- Use Prisma parameterized queries (no raw SQL injection)

## Common Patterns & Idioms

### Adding a New Scene Node Type
1. Extend node types in `apps/web/src/types/`
2. Add shape factory in scene store (`state/scene.ts`)
3. Update SVGStage renderer to handle new type
4. Add undo/redo command for creation/deletion
5. Update serialization/deserialization in persistence hooks

### Adding a New API Endpoint
1. Create/update module in `apps/api/src/`
2. Define DTO with validation decorators
3. Add controller method with guards
4. Implement service logic (use Prisma for DB, storage service for files)
5. Add Jest test in `*.spec.ts`
6. Update API documentation in this file

### Modifying Prisma Schema
1. Edit `apps/api/prisma/schema.prisma`
2. Run `pnpm prisma:generate` (root) or `npx prisma generate` (apps/api/)
3. Run `pnpm prisma:push:local` or `docker compose exec api npx prisma db push`
4. Update affected services/controllers
5. Add migration in production (use `npx prisma migrate dev`)

### Adding a New Zustand Store
1. Create `apps/web/src/state/newStore.ts`
2. Define types, initial state, actions
3. Use `create<StoreType>()(...)` pattern
4. Import and use via `const { action } = useNewStore()`
5. For persistence: integrate with IndexedDB via `idb-keyval`

### Working with Image Tiles
1. Tiles requested via `apps/web/src/tiles/` utilities
2. LOD level computed from viewport scale
3. Tile URLs: `/tiles/:assetId/:z/:x/:y`
4. Frontend caches tiles with LRU eviction
5. Tiler worker generates 256px tiles (power-of-2 zoom levels)

## Debugging Tips

- API logs: `docker compose logs -f api`
- Database inspect: `npx prisma studio` (from apps/api/)
- MinIO console: http://localhost:9001 (minio/minio12345)
- React DevTools for Zustand state inspection
- Network tab for tile loading/API requests
- Check `storage/` directory if S3 env vars not set

## Additional References

- **AGENTS.md**: Repository guidelines, camera precision reference, testing protocols
- **scrapbook_app_plan.md**: Full milestone plan, tech stack pinned versions, architecture decisions
- **README.md**: Quick start, current status, environment setup
