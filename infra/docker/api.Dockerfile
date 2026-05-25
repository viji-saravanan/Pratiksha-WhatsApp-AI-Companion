FROM node:20-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile --filter @viji/api...
RUN pnpm --filter @viji/api... build

FROM node:20-alpine AS runtime

WORKDIR /app
RUN corepack enable \
  && apk add --no-cache poppler-utils tesseract-ocr

COPY package.json pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/worker ./apps/worker

CMD ["node", "apps/api/dist/server.js"]
