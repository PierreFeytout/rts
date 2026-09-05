# The one always-on process: the signaling broker, which also serves the
# built client as static files. One image covers both, so a deployment is a
# single container rather than a web host plus a WebSocket service.
#
# Multi-stage, because the build needs the whole toolchain (TypeScript, Vite,
# every devDependency) and the runtime needs a few hundred kilobytes of
# JavaScript and `ws`. Shipping the builder would be roughly a 20x image.

# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first, so a source-only change reuses the cached install layer.
# `npm ci` needs every workspace's package.json to resolve the lockfile.
COPY package.json package-lock.json ./
COPY packages/sim/package.json packages/sim/
COPY packages/content/package.json packages/content/
COPY packages/transport/package.json packages/transport/
COPY packages/protocol/package.json packages/protocol/
COPY packages/netcode/package.json packages/netcode/
COPY packages/signaling/package.json packages/signaling/
COPY packages/client/package.json packages/client/
RUN npm ci

COPY . .
# Typecheck, test and lint here rather than only in CI: an image that builds
# but fails its own determinism tests is worse than a failed build.
RUN npm run typecheck && npm run lint && npm test
RUN npm run build:all

# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only what the broker actually loads at runtime.
COPY package.json package-lock.json ./
COPY packages/signaling/package.json packages/signaling/
RUN npm ci --omit=dev --workspace @rts/signaling --include-workspace-root \
    && npm cache clean --force

COPY --from=build /app/packages/signaling/dist packages/signaling/dist
COPY --from=build /app/packages/client/dist packages/client/dist

ENV PORT=8080
ENV HOST=0.0.0.0
ENV CLIENT_DIR=/app/packages/client/dist
EXPOSE 8080

# Never root. The broker reads static files and holds sockets; it has no
# reason to be able to write anywhere.
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/signaling/dist/server.js"]
