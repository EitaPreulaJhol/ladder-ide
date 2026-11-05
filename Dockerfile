# ---- build the web app
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY apps/bridge/package.json apps/bridge/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# ---- runtime: Node runs the TypeScript sources directly (type stripping)
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY apps/bridge/package.json apps/bridge/
RUN npm ci --omit=dev --ignore-scripts --workspace=@ladder/server --include-workspace-root=false && npm cache clean --force
COPY packages/core/src packages/core/src
COPY apps/server/src apps/server/src
COPY apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/server/src/index.ts"]
