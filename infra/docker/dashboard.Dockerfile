FROM node:20-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/dashboard ./apps/dashboard
COPY scripts/copy-dashboard-assets.mjs ./scripts/copy-dashboard-assets.mjs

RUN pnpm install --frozen-lockfile --filter @viji/dashboard...
RUN pnpm --filter @viji/dashboard... build

FROM node:20-alpine AS runtime

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/dashboard ./apps/dashboard

CMD ["node", "apps/dashboard/dist/server.js"]
