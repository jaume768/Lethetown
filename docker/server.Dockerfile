# syntax=docker/dockerfile:1
# Imagen del servidor (targets: api y worker). Se ejecuta con tsx: los paquetes del monorepo
# se consumen como TypeScript, sin paso de compilación.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/agent-core/package.json packages/agent-core/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@lethetown/server..."

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY --from=deps /app /app
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/server apps/server
COPY seeds seeds
COPY config config
# Caché del modelo de embeddings (volumen en docker-compose.prod.yml).
RUN mkdir -p /app/.cache && chown -R node:node /app/.cache
USER node
WORKDIR /app/apps/server

FROM runtime AS api
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/api-main.ts"]

FROM runtime AS worker
CMD ["node", "--import", "tsx", "src/worker.ts"]
