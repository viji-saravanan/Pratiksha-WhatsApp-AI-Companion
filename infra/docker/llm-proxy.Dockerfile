FROM node:20-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/llm-proxy ./apps/llm-proxy

RUN pnpm install --frozen-lockfile --filter @viji/llm-proxy...
RUN pnpm --filter @viji/llm-proxy... build

FROM node:20-alpine AS runtime

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/llm-proxy ./apps/llm-proxy

CMD ["node", "apps/llm-proxy/dist/server.js"]
