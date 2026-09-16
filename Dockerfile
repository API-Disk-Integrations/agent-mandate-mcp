# Agent Mandate MCP server.
#
# stdio transport: the container talks JSON-RPC over stdin/stdout and listens on
# no port. Do not add EXPOSE or a healthcheck; there is nothing to probe, and a
# port here would imply a remote endpoint this server deliberately does not have.
#
# Two stages so the published image carries no TypeScript toolchain. The build
# stage needs devDependencies to compile; the runtime stage installs production
# dependencies only.

FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so a source-only change does not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# --omit=dev leaves typescript and tsx out of the runtime image.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server.json README.md LICENSE THREAT_MODEL.md ROLLBACK.md ./

# The upstream node image ships an unprivileged `node` user. Verification needs
# no filesystem writes and no privileges, so it should not run as root.
USER node

# AGENT_MANDATE_API_KEY is supplied by the MCP client at run time and is
# deliberately NOT baked in. Without it the server starts and refuses tool calls,
# which is the correct behaviour rather than a misconfiguration.
ENTRYPOINT ["node", "dist/src/index.js"]
