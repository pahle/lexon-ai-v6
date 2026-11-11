ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global "$(node --input-type=module -e 'import {readFileSync} from "node:fs"; process.stdout.write(JSON.parse(readFileSync("package.json","utf8")).packageManager)')"
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY shared/package.json shared/package.json
COPY evals/package.json evals/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS build
COPY tsconfig.base.json ./
COPY scripts/container-images.mjs scripts/container-images.d.mts scripts/
COPY shared shared
COPY backend backend
RUN pnpm --filter @lexon/contracts build && pnpm --filter @lexon/backend build
RUN pnpm --filter @lexon/backend deploy --prod --legacy /production/backend

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /production/backend/node_modules backend/node_modules
COPY --from=build --chown=node:node /app/backend/package.json backend/package.json
COPY --from=build --chown=node:node /app/backend/dist backend/dist
COPY --from=build --chown=node:node /app/backend/drizzle backend/drizzle
COPY --from=build --chown=node:node /app/backend/config backend/config
RUN mkdir -p /run/lexon/health && chown node:node /run/lexon/health
USER node

FROM runtime AS api
CMD ["node", "backend/dist/entrypoints/api/main.js"]
FROM runtime AS ai-worker
CMD ["node", "backend/dist/entrypoints/ai-worker/main.js"]
FROM runtime AS dispatcher
CMD ["node", "backend/dist/entrypoints/dispatcher/main.js"]
FROM runtime AS document-worker
CMD ["node", "backend/dist/entrypoints/document-worker/main.js"]

FROM runtime AS e2e-test-worker
COPY --chown=node:node backend/test/e2e/chat-worker-main.mjs backend/test/e2e/chat-worker-control.mjs backend/test/e2e/
CMD ["node", "backend/test/e2e/chat-worker-main.mjs"]

FROM document-worker AS production
