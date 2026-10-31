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
ENV NEXT_TELEMETRY_DISABLED=1
ARG BACKEND_INTERNAL_URL=http://api:3001
ENV BACKEND_INTERNAL_URL=${BACKEND_INTERNAL_URL}
COPY tsconfig.base.json ./
COPY shared shared
COPY frontend frontend
RUN pnpm --filter @lexon/contracts build && pnpm --filter @lexon/frontend build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static frontend/.next/static
USER node
CMD ["node", "frontend/server.js"]
