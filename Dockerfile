# Stage 1: Install production dependencies
FROM oven/bun:1-alpine AS install
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Stage 2: Build
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY tsconfig.json ./
RUN bun build ./src/index.ts --outdir ./dist --target bun --minify --sourcemap=external --external @platformatic/kafka --external @platformatic/wasm-utils

# Stage 3: Production runtime
FROM oven/bun:1-distroless
WORKDIR /app
COPY --from=install /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

ENV NODE_ENV=production
EXPOSE 3000

USER 65532

ENTRYPOINT ["bun", "run", "dist/index.js"]
