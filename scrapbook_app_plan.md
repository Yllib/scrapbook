# PLAN.md

## 0) Baseline Constraints

- Targets: desktop, tablet, phone (Chrome, Safari, Firefox; iOS/iPadOS 16+, Android 11+)
- Performance: 60 fps target. Allow 30 fps minimum on mid-tier phones during heavy pans.
- Memory budgets: \~256 MB GPU textures mobile, \~1 GB desktop. Cap devicePixelRatio at 1.5 on mobile.
- Infinite 2D world coordinates
- Undo/redo with command log and snapshots
- Scene JSON <1 MB per 1k nodes (excluding assets)

## 1) Tech Stack (Pinned Versions)

**Frontend:**

- Node.js 24 LTS
- pnpm 9.x
- TypeScript 5.9.x
- Vite 7.2.x
- React 19.2.0
- Zustand 5.0.8
- TanStack Query 5.90.x
- PixiJS 8.14.0
- gl-matrix 3.4.4
- rbush 4.0.1
- comlink 4.4.2
- workbox-build 7.3.0

**Collab + Backend:**

- Yjs 13.6.26 (with y-websocket)
- NestJS 11.1.x
- Prisma 6.19.0
- PostgreSQL 18
- S3-compatible storage (AWS S3 + CloudFront)

**Asset Processing:**

- sharp 0.34.5

**Security:**

- Lock deps, audit on CI, block merges on high severity

## 2) Repo & CI/CD

- Single repo: `scrapbook` using pnpm workspaces. No separate repos.
- Workspaces: `apps/web`, `apps/api`, `workers/tiler`, `infra`.
- CI: GitHub Actions, Node 24 matrix. Jobs: typecheck, unit, e2e, build, dockerize, trivy scan.
- CD: Terraform in `infra` to deploy staging and prod.

## 3) Data Model

Scene graph (JSON):

```ts
NodeBase {
  id: string;
  type: "image" | "shape" | "text" | "group";
  transform: Mat3;
  worldAABB: [minX,minY,maxX,maxY];
  order: number;
  visible: boolean;
  locked: boolean;
  children?: NodeId[];
}
```

Database tables:

- `projects`
- `assets`
- `asset_variants`
- `ops`

## 4) Rendering

- Pixi stage with world container
- Texture: atlas for small sprites, individual textures for photos
- Culling via rbush spatial index
- Max 200 draw calls/frame
- Vector text glyphs via precomputed geometry loader
- Gizmos on overlay layer

## 5) Infinite Canvas

- Wheel zoom anchored to cursor
- Clamp zoom 1e-4–1e4
- Pan with inertia

## 6) Spatial Index

- rbush for AABBs
- Click and marquee hit-testing

## 7) Asset Pipeline

- Upload to S3
- Sharp generates AVIF/WebP, mips, 256px tiles
- Store EXIF + checksum

## 8) Performance

- OffscreenCanvas renderer in worker
- Decode via `createImageBitmap`
- LRU GPU/CPU caches
- LOD for image, shape, and text

## 9) Editing Tools

- Selection, transform, shapes, text editing
- Group/ungroup
- Snap/grid

## 10) Undo/Redo

- Command pattern with snapshots
- Persist to IndexedDB and server log

## 11) Realtime Collaboration

- Yjs `Y.Map`, `Y.Array`, `Y.Text`
- Awareness API for cursors
- y-websocket gateway on NestJS

## 12) Offline/PWA

- workbox-build `injectManifest`
- Cache static assets, tiles, scenes
- Background sync for uploads
- IndexedDB for local cache

## 13) Security

- CI audit gates
- Weekly renovate PRs
- Pin versions

## 14) Accessibility

- Keyboard shortcuts
- ARIA for panels
- Zoom-to-fit
- 44px touch targets

## 15) Testing

- Unit: transforms, culling, undo
- Visual: snapshot tests
- Perf: scripted pans/zooms
- E2E: Playwright flows

## 16) API Surface

- `POST /projects`
- `GET /projects/:id`
- `PATCH /projects/:id`
- `POST /assets`
- `GET /assets/:id/meta`
- `GET /tiles/:assetId/:z/:x/:y`
- WebSocket: `/collab/:projectId`

## 17) Project Structure (single repo)

```
scrapbook/
  package.json                # root with workspaces and scripts
  pnpm-workspace.yaml
  tsconfig.base.json
  .github/workflows/ci.yml
  infra/                      # terraform, docker, k8s manifests
  apps/
    web/
      src/
        app/
        canvas/
        workers/
        models/
        pwa/
      index.html
      vite.config.ts
      package.json
    api/
      src/
        main.ts
        modules/
          auth/
          projects/
          assets/
          collab/
        prisma/
          schema.prisma
      package.json
  workers/
    tiler/
      src/
        index.ts              # sharp tiling worker
      package.json
```

Root scripts:

```json
{
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck"
  }
}
```

## 18) Milestones

Completion of a milestone means each listed feature set is implemented, measurable tests or demos prove behavior, and no regressions appear in prior milestones.

- M0: Scaffold – Repo and build system exist. You can run pnpm dev and see a blank app in the browser. CI builds pass.
- M1: Camera/render – The PixiJS canvas renders a grid or test sprites. Pan and zoom work smoothly at 60 fps. No UI, just a moving view.
- M2: Scene/selection – You can create, list, and select elements (rectangles or placeholders). Click and marquee selection behave correctly.
- M3: Transforms – Drag, scale, and rotate selected objects with handles. Undo/redo returns state precisely.
- M4: Assets/tiles – Uploading images creates visible, zoom-adaptive tiles from the server. Large photos scroll smoothly.
- M5: Shapes – Add and edit vector shapes with fill/stroke. Shape data persists in scene JSON.
- M6: Text – Add editable text objects using SDF fonts. Text stays crisp when zoomed.
- M7: Persistence – Save/load projects to backend and IndexedDB. Reopen sessions restores state.
- M8: Collaboration – Two browser sessions sync via Yjs. Edits and cursors propagate instantly.
- M9: PWA/offline – App installs and loads offline. Cached tiles and scenes reopen without network
- M10: Hardening – Performance, accessibility, security, and automated tests meet all acceptance criteria.
- M11: Mobile polish – Gestures and layout work on phones/tablets. Frame-rate and memory targets achieved.
  - Gesture tuning, DPR caps, texture limits, UI responsive checks, VKB handling, energy saver mode

## 19) Commands

```bash
# create repo
mkdir scrapbook && cd scrapbook
git init

# enable pnpm workspaces
pnpm init -y
cat > pnpm-workspace.yaml <<'YAML'
packages:
  - apps/*
  - workers/*
  - infra
YAML

# root tooling
pnpm add -D typescript@5.9.0 @types/node@20

# apps/web
mkdir -p apps && cd apps
pnpm dlx create-vite@7.2.2 web --template react-ts
cd web
pnpm add react@19.2.0 react-dom@19.2.0
pnpm add pixi.js@8.14.0 gl-matrix@3.4.4 zustand@5.0.8 @tanstack/react-query@5.90.7 rbush@4.0.1 comlink@4.4.2 workbox-build@7.3.0 idb-keyval
pnpm add -D vite@7.2.2 typescript@5.9.0

# apps/api
cd ../
pnpm dlx @nestjs/cli@11 new api --package-manager=pnpm --strict
cd api
pnpm add @nestjs/config @nestjs/platform-express class-validator class-transformer
pnpm add @nestjs/websockets ws y-websocket yjs
pnpm add prisma@6.19.0 @prisma/client@6.19.0
pnpm add @aws-sdk/client-s3 sharp@0.34.5

# workers/tiler
cd ../../
mkdir -p workers/tiler && cd workers/tiler
pnpm init -y
pnpm add sharp@0.34.5 @aws-sdk/client-s3

# root scripts
cd ../../
jq '.scripts={"dev":"pnpm -r --parallel dev","build":"pnpm -r build","test":"pnpm -r test","lint":"pnpm -r lint","typecheck":"pnpm -r typecheck"}' package.json > package.tmp && mv package.tmp package.json
```

## 20) Telemetry & Quotas

- Metrics: fps, GPU mem, tile cache
- Quotas: per-user storage, node limits

## 21) Deliverables Checklist

- All pinned versions used
- Meets perf + UX targets
- Full test suite green
- CI/CD reproducible
- Ready for production deploy

## 22) Dockerization

### Files to add

```
.dockerignore
.env.example
Dockerfile.web          # apps/web
Dockerfile.api          # apps/api
Dockerfile.tiler        # workers/tiler
docker-compose.yml
nginx.conf              # SPA routing for web
```

### .dockerignore

```
**/node_modules
**/dist
**/.vite
**/.turbo
**/.next
.git
.gitignore
Dockerfile*
.dockerignore
.env*
coverage
.vscode
.idea
```

### Dockerfile.web (multi-stage build → Nginx static)

```Dockerfile
# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate \
  && pnpm -w fetch \
  && pnpm -w install --frozen-lockfile
COPY apps/web apps/web
WORKDIR /app/apps/web
RUN pnpm build

FROM nginx:1.27-alpine AS run
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK CMD wget -qO- http://127.0.0.1/ || exit 1
```

### nginx.conf (SPA + cache headers)

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;

  location / {
    try_files $uri /index.html;
  }

  location ~* \.(js|css|png|jpg|jpeg|gif|svg|woff2)$ {
    expires 30d;
    add_header Cache-Control "public, max-age=2592000";
  }
}
```

### Dockerfile.api (NestJS + Prisma)

```Dockerfile
# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate \
  && pnpm -w fetch \
  && pnpm -w install --frozen-lockfile

FROM deps AS build
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN pnpm prisma generate && pnpm build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist /app/dist
COPY apps/api/package.json ./package.json
COPY apps/api/prisma ./prisma
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/main.js"]
```

### Dockerfile.tiler (sharp-friendly Debian base)

```Dockerfile
# syntax=docker/dockerfile:1
FROM node:24-bullseye-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY workers/tiler/package.json workers/tiler/
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate \
  && pnpm -w fetch \
  && pnpm -w install --frozen-lockfile
COPY workers/tiler workers/tiler
WORKDIR /worker/workers/tiler
ENV NODE_ENV=production
CMD ["dumb-init", "node", "src/index.js"]
```

### docker-compose.yml

```yaml
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: scrapbook
      POSTGRES_PASSWORD: scrapbook
      POSTGRES_DB: scrapbook
    volumes:
      - dbdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scrapbook"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: minio12345
    volumes:
      - miniodata:/data
    ports:
      - "9000:9000"
      - "9001:9001"

  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    environment:
      DATABASE_URL: postgresql://scrapbook:scrapbook@db:5432/scrapbook
      S3_ENDPOINT: http://minio:9000
      S3_REGION: us-east-1
      S3_ACCESS_KEY_ID: minio
      S3_SECRET_ACCESS_KEY: minio12345
      S3_BUCKET: scrapbook
      PORT: 3000
    depends_on:
      db:
        condition: service_healthy
      minio:
        condition: service_started
    ports:
      - "3000:3000"
    command: ["sh", "-c", "node dist/main.js"]

  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    depends_on:
      - api
    ports:
      - "8080:80"

  tiler:
    build:
      context: .
      dockerfile: Dockerfile.tiler
    environment:
      S3_ENDPOINT: http://minio:9000
      S3_REGION: us-east-1
      S3_ACCESS_KEY_ID: minio
      S3_SECRET_ACCESS_KEY: minio12345
      S3_BUCKET: scrapbook
    depends_on:
      minio:
        condition: service_started

volumes:
  dbdata:
  miniodata:
```

### .env.example

```
# API
DATABASE_URL=postgresql://scrapbook:scrapbook@db:5432/scrapbook
PORT=3000

# S3
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minio
S3_SECRET_ACCESS_KEY=minio12345
S3_BUCKET=scrapbook
```

### Make targets (optional)

```Makefile
up:
	docker compose up -d --build

down:
	docker compose down -v

logs:
	docker compose logs -f --tail=200
```

### Usage

```bash
# from repo root
cp .env.example .env  # if your tooling loads it
docker compose up -d --build
# web: http://localhost:8080
# api: http://localhost:3000
# minio console: http://localhost:9001
```

## 23) Mobile Support (definitive)

### Rendering

- Cap `devicePixelRatio` to 1.5 on mobile to bound fill-rate
- Clamp textures to 4096; prefer 256 px tiles; reduce LOD at far zoom
- Throttle to 30 fps during fast pans on low-tier devices

### Input & Gestures

- Use Pointer Events only. Map:
  - One finger: pan
  - Pinch: zoom anchored to centroid
  - Two-finger rotate: optional; default off
- Kinetic scrolling with velocity decay
- 44 px minimum hit targets

### UI & Layout

- Responsive layout with bottom toolbox on <768 px width
- Safe areas: respect `env(safe-area-inset-*)`
- Virtual keyboard: scroll focused text editor into view; avoid canvas resize jank
- Tooltips replaced with bottom sheets on mobile

### PWA on Mobile

- `display: standalone`, icons, splash, theme-color
- Add install prompts and update flow
- Background sync for queued uploads

### Energy & Memory

- Pause rendering in background tabs or when battery saver is detected
- GPU texture LRU capped at \~200 MB; evict least-recently-used

### File I/O

- Accept camera input; downscale large images in a worker using OffscreenCanvas before upload

### Acceptance Criteria

- iPhone 12 and Pixel 6 sustain 45–60 fps with 1k visible nodes
- All gestures work with one hand
- No crashes after 30 minutes of continuous editing

## 24) Mobile QA Matrix

- iOS/iPadOS 16–18 Safari, Chrome
- Android 11–15 Chrome, Samsung Internet
- Screen sizes: 360×780, 414×896, 768×1024, 1280×800
- Test cases: pan/zoom/rotate, text edit with keyboard, upload from camera, offline open/edit/sync
