# The Acme demo as one service: the agent API plus the built console.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
# Only the Acme demo and what it uses: the root tooling plus both apps and their workspace packages.
RUN pnpm install --frozen-lockfile --filter . --filter "acme-api..." --filter "acme-console..."  && pnpm --filter "acme-api..." --filter "acme-console..." --workspace-concurrency=1 build

FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY --from=build /app /app
ENV NODE_ENV=production PORT=8787 LOCAL_MODELS=0
EXPOSE 8787
CMD ["pnpm", "--filter", "acme-api", "start"]
