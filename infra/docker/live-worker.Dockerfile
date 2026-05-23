FROM golang:1.25-bookworm AS wacli-build

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

RUN GOBIN=/out go install -tags sqlite_fts5 github.com/steipete/wacli/cmd/wacli@v0.6.0
WORKDIR /src/wacli-mark-read
COPY tools/wacli-mark-read ./
RUN go build -tags sqlite_fts5 -o /out/wacli-mark-read .

FROM node:20-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY apps/wa-adapter-wacli ./apps/wa-adapter-wacli

RUN pnpm install --frozen-lockfile --filter @viji/worker... --filter @viji/wa-adapter-wacli...
RUN pnpm --filter @viji/worker... --filter @viji/wa-adapter-wacli... build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=wacli-build /out/wacli /usr/local/bin/wacli
COPY --from=wacli-build /out/wacli-mark-read /usr/local/bin/wacli-mark-read
COPY package.json pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker ./apps/worker
COPY --from=build /app/apps/wa-adapter-wacli ./apps/wa-adapter-wacli
COPY scripts/live-worker-daemon.mjs ./scripts/live-worker-daemon.mjs
COPY scripts/lib ./scripts/lib

CMD ["node", "scripts/live-worker-daemon.mjs"]
