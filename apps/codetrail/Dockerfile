# Codetrail in one container: your Nebius key, a data volume, and (optionally) your code folders.
#   docker build -t codetrail .
#   docker run -p 127.0.0.1:3000:3000 -e NEBIUS_API_KEY=... -e NEBIUS_MODEL=moonshotai/Kimi-K3.1-Pro \
#     -v codetrail-data:/data -v ~/code:/repos:ro codetrail

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-slim
# The diagram PNG's labels are SVG text drawn with system fonts; the slim image ships none.
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/data/codetrail.db LOCAL_ROOT=/repos
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/drizzle ./drizzle
RUN mkdir -p /data /repos && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
