# Bun Runtime & Infrastructure Guide

A comprehensive guide to building production TypeScript applications with Bun -- monorepo setup, native HTTP/WebSocket/SSE servers, CLI tooling, concurrency primitives, and code quality toolchain. Companion to `UI_UX_STYLE_GUIDE.md` (frontend) and `LANGGRAPH_WORKFLOW_GUIDE.md` (AI backend).

### How to Read This Guide

This guide describes **portable patterns** for building TypeScript backends and monorepos with Bun. The patterns -- workspace catalogs, native route systems, semaphore-based concurrency, checkpoint-based resumability -- apply to any Bun project.

Code snippets throughout are **reference implementations** from the AWS Cost Analyzer project. When adapting to a different domain:

- **Keep the infrastructure**: monorepo layout, server setup, route factory pattern, concurrency utilities, config system, orchestration patterns
- **Replace the domain layer**: swap cost-analysis routes for your domain's endpoints, replace sync scripts with your operational workflows
- **Scale as needed**: the patterns work for small single-package projects too -- just drop the workspace layer

Each section opens with the **pattern** (what and why), then shows the **implementation** (how, with source references). The patterns are the point; the code is the proof.

---

## Table of Contents

1. [Why Bun](#1-why-bun)
2. [Monorepo & Workspaces](#2-monorepo--workspaces)
3. [TypeScript Configuration](#3-typescript-configuration)
4. [Bun.serve() HTTP Server](#4-bunserve-http-server)
5. [Native Route System](#5-native-route-system)
6. [WebSocket Integration](#6-websocket-integration)
7. [Server-Sent Events (SSE)](#7-server-sent-events-sse)
8. [Environment & Configuration](#8-environment--configuration)
9. [Bun Native APIs](#9-bun-native-apis)
10. [CLI & Script Patterns](#10-cli--script-patterns)
11. [Concurrency Primitives](#11-concurrency-primitives)
12. [Orchestration & Resumability](#12-orchestration--resumability)
13. [SvelteKit + Bun](#13-sveltekit--bun)
14. [Code Quality Toolchain](#14-code-quality-toolchain)
15. [Build, Dev & Deployment](#15-build-dev--deployment)

---

## 1. Why Bun

### Pattern

Bun is a JavaScript/TypeScript runtime that replaces Node.js, npm, and bundling tools with a single binary. The key advantages for backend applications:

| Capability | Bun | Node.js |
|-----------|-----|---------|
| TypeScript execution | Native, zero config | Requires ts-node, tsx, or compilation step |
| Package management | Built-in (`bun install`), faster lockfile resolution | npm/yarn/pnpm (separate tools) |
| HTTP server | `Bun.serve()` with native routing | Express/Fastify/Koa (external packages) |
| WebSocket | Native in `Bun.serve()` | ws package (external) |
| `.env` loading | Automatic | dotenv package (external) |
| Test runner | Built-in (`bun test`) | Jest/Vitest (external packages) |
| Bundling | Built-in (`bun build`) | Webpack/Rollup/esbuild (external) |
| Process spawning | `Bun.spawn()` returns promise-based API | `child_process.spawn()` callback-based |
| Performance timing | `Bun.nanoseconds()` nanosecond precision | `performance.now()` millisecond precision |

### When to Choose Bun

**Good fit**: TypeScript backends, API servers, CLI tools, monorepos, rapid development where you want zero-config TypeScript and fewer dependencies.

**Caution**: Production workloads requiring battle-tested Node.js ecosystem compatibility (some npm packages with native addons may not work), serverless platforms that don't support Bun, or teams with deep Node.js operational expertise.

### Runtime Guard

Always verify the runtime at application entry:

```typescript
// src/utils/runtime.ts
export const isBun = (): boolean => typeof Bun !== "undefined";
```

```typescript
// src/index.ts
if (!isBun()) {
  throw new Error("This application requires Bun runtime");
}
```

This prevents mysterious failures when accidentally run with Node.js.

---

## 2. Monorepo & Workspaces

### Pattern

Bun workspaces let you manage multiple packages in a single repository with shared dependencies, version catalogs, and cross-package scripts. The key features beyond npm workspaces are **catalogs** (centralized version pinning) and **`--filter`** (targeted package commands).

### Reference Implementation

Source: `/package.json` (root)

```json
{
  "name": "aws-cost-analyzer",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "workspaces": {
    "packages": [
      "packages/*"
    ],
    "catalog": {
      "@types/bun": "1.3.9",
      "typescript": "^5",
      "couchbase": "4.4.3"
    },
    "catalogs": {
      "aws": {
        "@aws-sdk/client-bedrock-runtime": "^3.0.0",
        "@aws-sdk/client-cost-explorer": "^3.0.0"
      },
      "frontend": {
        "@sveltejs/kit": "^2.53.4",
        "@sveltejs/vite-plugin-svelte": "^6.2.4",
        "svelte": "^5.53.10",
        "vite": "^7.3.1"
      },
      "dev": {
        "@types/bun": "latest",
        "typescript": "^5"
      }
    }
  },
  "scripts": {
    "dev": "bun --hot index.ts",
    "build": "bun run build:packages",
    "build:packages": "bun run --filter='packages/*' build",
    "test": "bun test --recursive",
    "lint": "bun run --recursive lint",
    "clean": "bun run --recursive clean",
    "cli": "bun run packages/backend/src/cli/index.ts",
    "api": "bun run packages/backend/src/api/server.ts",
    "frontend": "bun run --filter='@aws-cost-analyzer/frontend' dev",
    "dev:full": "concurrently \"bun run api\" \"bun run frontend\"",
    "typecheck": "bun run --recursive typecheck",
    "biome:check": "biome check .",
    "biome:check:write": "biome check --write .",
    "quality:check": "bun run biome:check && bun run typecheck",
    "quality:fix": "bun run biome:check:write && bun run typecheck"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.3.15",
    "@types/bun": "catalog:",
    "typescript": "catalog:"
  }
}
```

### Key Concepts

#### Version Catalogs

Catalogs centralize dependency versions so all packages use the same version. In child `package.json` files, reference them with `"catalog:"` or `"catalog:name"`:

```json
// packages/backend/package.json
{
  "devDependencies": {
    "@types/bun": "catalog:",
    "typescript": "catalog:"
  }
}

// packages/frontend/package.json
{
  "devDependencies": {
    "@sveltejs/kit": "catalog:frontend",
    "svelte": "catalog:frontend",
    "vite": "catalog:frontend",
    "typescript": "catalog:"
  }
}
```

- `"catalog:"` -- references the default `catalog` object
- `"catalog:frontend"` -- references the named `catalogs.frontend` object

This eliminates version drift across packages without the overhead of a tool like Renovate for internal version management.

#### Workspace Commands

```bash
# Run a script in all packages
bun run --recursive typecheck

# Run a script in a specific package by name
bun run --filter='@aws-cost-analyzer/frontend' dev

# Run a script in packages matching a glob
bun run --filter='packages/*' build
```

#### Lockfile

Bun uses `bun.lock` (JSON-based, text format). It's workspace-aware with separate dependency sections per package. Always commit it to version control.

### Directory Structure

```
project-root/
  package.json          # Workspace config + root scripts
  bun.lock              # Lockfile (committed)
  tsconfig.json         # Root TypeScript config
  biome.json            # Code quality (shared across packages)
  .env                  # Environment variables (Bun auto-loads)
  packages/
    backend/
      package.json      # Backend deps (uses catalog: refs)
      tsconfig.json     # Extends root, adds path aliases
      src/
        index.ts        # Bun.serve() entry point
    frontend/
      package.json      # Frontend deps (uses catalog:frontend refs)
      tsconfig.json     # Extends SvelteKit auto-generated config
      src/
```

---

## 3. TypeScript Configuration

### Pattern

Bun executes TypeScript natively -- no transpilation step needed during development. The TypeScript configuration focuses on **type checking only** (`noEmit: true`) with `moduleResolution: "bundler"` for ESM-native import resolution.

### Reference Implementation

Source: `/tsconfig.json` (root)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "composite": true,
    "strict": true,
    "strictNullChecks": false,
    "noImplicitAny": false,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "allowJs": true,
    "checkJs": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["bun-types"]
  },
  "include": [],
  "references": [
    { "path": "./packages/backend" },
    { "path": "./packages/frontend" }
  ]
}
```

### Key Decisions

| Setting | Value | Why |
|---------|-------|-----|
| `moduleResolution` | `"bundler"` | Bun's preferred mode; supports `.ts` extension imports |
| `allowImportingTsExtensions` | `true` | Enables `import { foo } from "./bar.ts"` |
| `noEmit` | `true` | Bun runs TypeScript directly; TS is for type checking only |
| `composite` | `true` | Required for project references in monorepos |
| `types` | `["bun-types"]` | Adds Bun global types (`Bun`, `ServerWebSocket`, etc.) |
| `target` | `"ES2022"` | Bun supports modern JS natively |
| `strictNullChecks` | `false` | Relaxes `strict: true` -- pragmatic for rapid iteration with database/API code where null checks are verbose |
| `noImplicitAny` | `false` | Relaxes `strict: true` -- allows implicit `any` in callback parameters and third-party interop |

### Import Conventions

```typescript
// Use .ts extensions in imports (Bun resolves them directly)
import { DatabaseManager } from "./database/index.ts";
import type { RouteHandler } from "./routes/types.ts";

// Use node: protocol for Node.js built-ins (Biome enforces this)
import { join } from "node:path";
import { readFileSync } from "node:fs";

// Bun-specific imports
import type { ServerWebSocket } from "bun";

// Import type for type-only imports (Biome enforces this)
import type { BackendConfig } from "./config/schemas.ts";
```

### Package-Level Config

Each package extends the root and adds its own concerns:

```json
// packages/backend/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "paths": {
      "@aws-cost-analyzer/database": ["./database/index.ts"]
    }
  },
  "include": ["src/**/*.ts"]
}
```

---

## 4. Bun.serve() HTTP Server

### Pattern

`Bun.serve()` provides a native HTTP server with built-in routing, WebSocket support, and error handling -- no Express or Fastify needed. Routes are defined as a plain object mapping URL patterns to handlers, using the Web Standards `Request`/`Response` API.

### Reference Implementation

Source: `packages/backend/src/index.ts`

```typescript
import { buildRoutes, handleCorsPrelight } from "./routes/index.ts";
import type { RouteDependencies } from "./routes/types.ts";
import { isBun } from "./utils/runtime.ts";

if (!isBun()) {
  throw new Error("This application requires Bun runtime");
}

// Global error handlers
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Promise Rejection:", reason);
  console.error("Promise:", promise);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  console.error("Stack:", error.stack);
  process.exit(1);
});

class BackendApplication {
  private dbManager!: DatabaseManager;

  private async isPortAvailable(port: number): Promise<boolean> {
    try {
      const testServer = Bun.serve({ port, fetch: () => new Response("test") });
      testServer.stop();
      return true;
    } catch (error) {
      const e = error as { code?: string };
      if (e.code === "EADDRINUSE") {
        return false;
      }
      return true;
    }
  }

  private async findAvailablePort(startPort: number): Promise<number> {
    for (let port = startPort; port <= startPort + 10; port++) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }
    throw new Error(`No available ports found in range ${startPort}-${startPort + 10}`);
  }

  async start(port: number) {
    await this.initialize();

    // Port availability detection with fallback
    let actualPort = port;
    if (!(await this.isPortAvailable(port))) {
      actualPort = await this.findAvailablePort(port + 1);
    }

    // Build routes with dependency injection
    const deps: RouteDependencies = {
      dbManager: this.dbManager,
      healthService: this.healthService,
      recommendationsRepository: this.recommendationsRepository,
      wsService: this.wsService,
      apiService: this.apiService,
    };

    const routes = buildRoutes(deps);

    const server = Bun.serve({
      port: actualPort,

      // Increase idle timeout for long-running SSE streams
      // Default is 10s which is too short for AI queries with multiple tool calls
      idleTimeout: 120, // 2 minutes (max 255)

      // Native Bun routes - all API endpoints defined here
      routes,

      // Minimal fetch handler for edge cases only
      fetch: async (req, server) => {
        // Handle WebSocket upgrade requests
        if (req.headers.get("upgrade") === "websocket") {
          if (server.upgrade(req)) {
            return; // WebSocket connection established
          }
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        // Handle CORS preflight OPTIONS requests
        if (req.method === "OPTIONS") {
          return handleCorsPrelight(req);
        }

        // 404 fallback - routes didn't match
        return Response.json(
          { error: "Not found" },
          {
            status: 404,
            headers: {
              "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
              "Access-Control-Allow-Credentials": "true",
            },
          }
        );
      },

      websocket: {
        open: (ws) => this.wsService.onConnection(ws),
        message: (ws, message) =>
          this.wsService.onMessage(
            ws,
            typeof message === "string" ? message : message.toString()
          ),
        close: (ws) => this.wsService.onClose(ws),
      },

      error: (error) => {
        console.error("Server error handler triggered:", error);
        return new Response(
          JSON.stringify({
            success: false,
            error: "Internal server error",
            timestamp: new Date().toISOString(),
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      },

      development: {
        hmr: true,
        console: true,
      },
    });

    // Graceful shutdown
    process.on("SIGINT", async () => {
      await this.dbManager.disconnect();
      process.exit(0);
    });

    return server;
  }
}

// Entry point guard -- only run when executed directly
if (import.meta.main) {
  const app = new BackendApplication();
  app.start(3000).catch((error) => {
    console.error("Application startup failed:", error);
    process.exit(1);
  });
}

// Exports for library usage
export { BackendApplication };
```

### Key Design Decisions

| Decision | Why |
|----------|-----|
| `idleTimeout: 120` | SSE streams for AI queries with multiple tool calls can run 30-60 seconds; default 10s would disconnect |
| `routes` object (not fetch) | Native Bun routing is faster than regex matching in fetch; cleaner separation of concerns |
| `fetch` fallback | Only handles WebSocket upgrade and OPTIONS preflight -- everything else goes through `routes` |
| `import.meta.main` guard | Prevents server from starting when imported as a library; Bun-specific (replaces Node.js `require.main === module`) |
| Port detection via `Bun.serve()` | Creates a test server to probe port availability -- more reliable than `net.createServer()` |
| `development.hmr: true` | Enables Hot Module Replacement during development; Bun reloads modules without restarting the server |

---

## 5. Native Route System

### Pattern

Instead of Express-style middleware chains, Bun uses a **route factory pattern**: each domain exports a function that receives dependencies and returns a routes object. These are composed into a single object passed to `Bun.serve()`. Middleware is implemented as higher-order functions wrapping handlers.

### Route Types

Source: `packages/backend/src/routes/types.ts`

```typescript
export type RouteHandler = (req: Request) => Promise<Response> | Response;

export type RouteDefinition =
  | {
      GET?: RouteHandler;
      POST?: RouteHandler;
      PUT?: RouteHandler;
      DELETE?: RouteHandler;
      PATCH?: RouteHandler;
    }
  | RouteHandler
  | Response;

export type RoutesObject = Record<string, RouteDefinition>;

export interface RouteDependencies {
  dbManager: DatabaseManager;
  healthService: HealthService;
  recommendationsRepository: RecommendationsRepository | null;
  wsService: WebSocketService;
  apiService: ApiService;
}

export type RouteFactory = (deps: RouteDependencies) => RoutesObject;
```

### Route Composition

Source: `packages/backend/src/routes/index.ts`

```typescript
import { createAIRoutes } from "./ai.routes.ts";
import { createCostsRoutes } from "./costs.routes.ts";
import { createHealthRoutes } from "./health.routes.ts";
import { createOrganizationalRoutes } from "./organizational.routes.ts";
import { createRecommendationsRoutes } from "./recommendations.routes.ts";
import { createSyncRoutes } from "./sync.routes.ts";
import type { RouteDependencies, RoutesObject } from "./types.ts";

/**
 * Order matters for routes with overlapping patterns!
 * More specific routes (e.g., /nodes/:id/costs) must come before
 * less specific ones (e.g., /nodes/:id).
 */
export function buildRoutes(deps: RouteDependencies): RoutesObject {
  return {
    ...createHealthRoutes(deps),
    ...createSyncRoutes(deps),
    ...createAIRoutes(deps),
    ...createOrganizationalRoutes(deps),
    ...createCostsRoutes(deps),
    ...createRecommendationsRoutes(deps),
  };
}
```

### Middleware Wrappers

Source: `packages/backend/src/routes/middleware.ts`

```typescript
import type { RouteHandler } from "./types.ts";

export function getCorsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Credentials": "true",
    "Content-Type": "application/json",
  };
}

export function handleCorsPrelight(req: Request): Response {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export function withCors(handler: RouteHandler): RouteHandler {
  return async (req: Request) => {
    const corsHeaders = getCorsHeaders(req);

    try {
      const response = await handler(req);

      // Merge CORS headers with response headers (don't overwrite existing)
      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        if (!newHeaders.has(key)) {
          newHeaders.set(key, value);
        }
      }

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Internal server error",
          details: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  };
}

export function withSSE(handler: RouteHandler): RouteHandler {
  return async (req: Request) => {
    const origin = req.headers.get("origin") || "*";

    try {
      const response = await handler(req);

      // Force SSE headers
      return new Response(response.body, {
        status: response.status,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (_error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Stream error",
          timestamp: new Date().toISOString(),
        }),
        {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Content-Type": "application/json",
          },
        }
      );
    }
  };
}
```

### Route Factory Example

```typescript
// src/routes/health.routes.ts
export function createHealthRoutes(deps: RouteDependencies): RoutesObject {
  return {
    "/api/health": {
      GET: withCors(async (_req) => {
        return Response.json({ status: "healthy", timestamp: new Date().toISOString() });
      }),
    },
    "/api/health/detailed": {
      GET: withCors(async (req) => {
        const health = await deps.healthService.getDetailedHealth();
        return Response.json(health);
      }),
    },
  };
}
```

### Key Principles

1. **Route ordering matters**: More specific routes (`/nodes/:id/costs`) must come before less specific ones (`/nodes/:id`) in the composed object
2. **Web Standards only**: Use `Request`, `Response`, `Headers` -- no Express-specific APIs
3. **Middleware as HOFs**: `withCors(handler)` and `withSSE(handler)` wrap handlers cleanly without a middleware chain
4. **Dependency injection**: Route factories receive deps, avoiding globals

---

## 6. WebSocket Integration

### Pattern

Bun's `Bun.serve()` includes native WebSocket support -- no `ws` package needed. WebSocket handlers are defined alongside HTTP routes in the same server. The upgrade happens in the `fetch` fallback when the `Upgrade: websocket` header is detected.

### Reference Implementation

Source: `packages/backend/src/services/websocket-service.ts`

```typescript
import type { ServerWebSocket } from "bun";

interface WebSocketMessage {
  type: "cost_update" | "anomaly_alert" | "recommendation_update";
  data: unknown;
  timestamp: string;
}

export class WebSocketService {
  private clients = new Set<ServerWebSocket<unknown>>();
  private subscriptions = new Map<ServerWebSocket<unknown>, Set<string>>();

  onConnection(ws: ServerWebSocket<unknown>) {
    this.clients.add(ws);
    this.subscriptions.set(ws, new Set());

    this.sendToClient(ws, {
      type: "cost_update",
      data: { message: "Connected to real-time feed" },
      timestamp: new Date().toISOString(),
    });
  }

  onMessage(ws: ServerWebSocket<unknown>, message: string) {
    try {
      const parsed = JSON.parse(message) as { type?: string; accountId?: string };

      if (parsed.type === "subscribe" && parsed.accountId) {
        const subs = this.subscriptions.get(ws);
        if (subs) subs.add(parsed.accountId);
      } else if (parsed.type === "unsubscribe" && parsed.accountId) {
        const subs = this.subscriptions.get(ws);
        if (subs) subs.delete(parsed.accountId);
      }
    } catch (_error) {}
  }

  onClose(ws: ServerWebSocket<unknown>) {
    this.clients.delete(ws);
    this.subscriptions.delete(ws);
  }

  async broadcastToSubscribers(accountId: string, message: WebSocketMessage) {
    const subscribedClients = Array.from(this.subscriptions.entries())
      .filter(([_, subs]) => subs.has(accountId) || subs.has("*"))
      .map(([client]) => client);

    for (const client of subscribedClients) {
      this.sendToClient(client, message);
    }
  }

  private sendToClient(ws: ServerWebSocket<unknown>, message: WebSocketMessage) {
    try {
      ws.send(JSON.stringify(message));
    } catch (_error) {
      // Remove disconnected client
      this.clients.delete(ws);
      this.subscriptions.delete(ws);
    }
  }

  getClientStats() {
    return {
      totalClients: this.clients.size,
      subscriptions: Array.from(this.subscriptions.entries())
        .flatMap(([_, subs]) => Array.from(subs)),
    };
  }
}
```

### Server Integration

The WebSocket service is wired into `Bun.serve()`:

```typescript
const server = Bun.serve({
  routes,

  fetch: async (req, server) => {
    // WebSocket upgrade in fetch fallback
    if (req.headers.get("upgrade") === "websocket") {
      if (server.upgrade(req)) {
        return; // Connection established
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    // ... other fallback handling
  },

  websocket: {
    open: (ws) => wsService.onConnection(ws),
    message: (ws, message) =>
      wsService.onMessage(ws, typeof message === "string" ? message : message.toString()),
    close: (ws) => wsService.onClose(ws),
  },
});
```

### Key Points

- **`ServerWebSocket<T>`** is Bun's typed WebSocket class (imported from `"bun"`)
- **Upgrade happens in `fetch`**, not in routes -- WebSocket connections don't go through the route system
- **Subscription-based broadcast**: Clients subscribe to topics (e.g., account IDs), and broadcasts target only subscribed clients
- **Wildcard subscriptions**: `"*"` subscribes to all topics
- **Auto-cleanup**: Failed sends automatically remove the disconnected client

---

## 7. Server-Sent Events (SSE)

### Pattern

SSE provides one-way server-to-client streaming over HTTP. In Bun, this is built on the Web Standards `ReadableStream` API with `TextEncoder`. No external library needed -- just construct a stream that yields `data: ...\n\n` formatted events.

### Reference Implementation

Source: `packages/backend/src/routes/ai.ts`

```typescript
const encoder = new TextEncoder();
const service = this.costAnalysisService;

const stream = new ReadableStream({
  async start(controller) {
    try {
      for await (const event of service.processQueryStream(analysisRequest)) {
        const sseData = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(sseData));
      }
    } catch (error) {
      const errorEvent = {
        type: "error",
        message: error instanceof Error ? error.message : "Stream error",
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
    } finally {
      controller.close();
    }
  },
});

return new Response(stream, {
  headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  },
});
```

### SSE Pattern Breakdown

1. **Async generator as source**: The service exposes a `processQueryStream()` async generator that yields typed events
2. **TextEncoder**: Converts string data to `Uint8Array` for the stream controller
3. **SSE format**: Each event is `data: <json>\n\n` (double newline terminates each event)
4. **Error in-band**: Errors are sent as events (not HTTP errors) since the stream has already started
5. **Controller lifecycle**: `enqueue()` to send data, `close()` when done
6. **`withSSE()` middleware**: Forces correct headers (Content-Type, Cache-Control, Connection)

### SSE vs WebSocket

| | SSE | WebSocket |
|---|-----|-----------|
| Direction | Server -> Client only | Bidirectional |
| Protocol | HTTP (standard) | WebSocket (upgrade) |
| Auto-reconnect | Built into EventSource API | Manual |
| Use case | Progress updates, streaming responses | Real-time bidirectional communication |

In this project, SSE is used for AI query streaming (progress updates during graph execution), while WebSocket is used for real-time cost update broadcasts.

### SSE Keepalive for Long-Lived Connections

**Problem**: HTTP clients, reverse proxies, and load balancers enforce idle timeouts on connections that stop transmitting data. For SSE streams where events arrive in bursts with long gaps between them (e.g., an AI agent executing a multi-step tool chain), the connection may be killed mid-stream after 30-60s of silence, producing opaque `UND_ERR_BODY_TIMEOUT` or proxy 504 errors on the client.

**Solution**: Send periodic SSE comment frames (`: keepalive\n\n`) on a timer. SSE comments (lines starting with `:`) are defined in the spec as ignored by the `EventSource` API, so they keep the TCP connection alive without triggering client-side event handlers.

```typescript
const KEEPALIVE_INTERVAL_MS = 30_000;

function startKeepalive(res: http.ServerResponse): NodeJS.Timeout {
  const interval = setInterval(() => {
    try {
      if (!res.writableEnded) {
        res.write(": keepalive\n\n");
      }
    } catch {
      clearInterval(interval);
    }
  }, KEEPALIVE_INTERVAL_MS);

  // Don't let the keepalive timer prevent graceful process shutdown
  interval.unref();
  return interval;
}
```

**Key design decisions**:

| Decision | Why |
|----------|-----|
| 30s interval | Under most proxy defaults (60s Nginx, 120s AWS ALB) with margin |
| `.unref()` | Allows the process to exit cleanly without waiting for the timer |
| `try/catch` guard | The client may disconnect between the `writableEnded` check and the `write()` call |
| Comment frame (`: keepalive`) | Spec-compliant no-op -- `EventSource` ignores lines starting with `:` |

**When to use**: Any SSE endpoint where gaps between meaningful events can exceed ~15 seconds. Common in AI streaming (tool execution pauses), long-running jobs, and dashboard live feeds. If your events are sub-second (e.g., log tailing), keepalive is unnecessary overhead.

---

## 8. Environment & Configuration

### Pattern

Bun automatically loads `.env` files, but in a monorepo you need to handle workspace root detection since scripts run from child package directories. The **4-pillar config pattern** separates concerns: schemas (validation), defaults (fallbacks), env mapping (var names), and loader (assembly).

### Workspace Root .env Detection

Source: `packages/backend/src/config/loader.ts`

```typescript
export const getEnvSource = (): Record<string, string> => {
  if (typeof Bun !== "undefined") {
    // Find project root by looking for package.json with workspaces
    let currentDir = process.cwd();
    let projectRoot = currentDir;

    while (currentDir !== path.dirname(currentDir)) {
      const packageJsonPath = path.join(currentDir, "package.json");
      try {
        const pkg = require(packageJsonPath);
        if (pkg.workspaces) {
          projectRoot = currentDir;
          break;
        }
      } catch (_e) {
        // Continue searching
      }
      currentDir = path.dirname(currentDir);
    }

    const rootEnvPath = path.join(projectRoot, ".env");

    try {
      const fs = require("node:fs");
      if (fs.existsSync(rootEnvPath)) {
        const envContent = fs.readFileSync(rootEnvPath, "utf-8");
        const envVars: Record<string, string> = {};

        envContent.split("\n").forEach((line) => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            const [key, ...valueParts] = trimmed.split("=");
            if (key && valueParts.length > 0) {
              let value = valueParts.join("=");
              value = value.replace(/^["']|["']$/g, "");
              envVars[key] = value;
            }
          }
        });

        // Merge with Bun.env (Bun.env takes precedence)
        return { ...envVars, ...Bun.env };
      }
    } catch (_error) {}

    return Bun.env as Record<string, string>;
  }

  // Node.js fallback
  try {
    require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
  } catch (_error) {}

  return process.env as Record<string, string>;
};
```

### 4-Pillar Config Pattern

```
Pillar 1: schemas.ts     -- Zod schemas defining valid config shapes
Pillar 2: envMapping.ts  -- Maps config keys to environment variable names
Pillar 3: loader.ts      -- Reads env vars, parses types, assembles config
Pillar 4: config.ts      -- Deep-merges defaults with env, validates, exports singleton
```

#### Pillar 1: Schemas (validation)

```typescript
// src/config/schemas.ts
import { z } from "zod";

export const PortNumber = z.number().int().min(1024).max(65535);
export const AwsRegion = z.string().superRefine((region, ctx) => {
  if (!/^[a-z]{2}-[a-z]+-[0-9]$/.test(region)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid AWS region" });
  }
});
```

#### Pillar 2: Env Mapping (var names)

```typescript
// src/config/envMapping.ts
export const envVarMapping = {
  environment: "NODE_ENV",
  aws: { region: "AWS_REGION", accessKeyId: "AWS_ACCESS_KEY_ID" },
  runtime: { port: "PORT", shutdownTimeout: "SHUTDOWN_TIMEOUT" },
  features: { enableAI: "ENABLE_AI", logLevel: "LOG_LEVEL" },
};
```

#### Pillar 3: Loader (parsing)

```typescript
// src/config/loader.ts
export function parseEnvVar(value: string | undefined, type: "string", fallback?: string): string;
export function parseEnvVar(value: string | undefined, type: "number", fallback?: number): number;
export function parseEnvVar(value: string | undefined, type: "boolean", fallback?: boolean): boolean;
export function parseEnvVar(
  value: string | undefined,
  type: "string" | "number" | "boolean",
  fallback?: string | number | boolean
): string | number | boolean {
  if (!value || value.trim() === "") return fallback as string | number | boolean;

  const cleanValue = value.trim().replace(/^["']|["']$/g, "");

  switch (type) {
    case "string": return cleanValue;
    case "number": {
      const num = Number(cleanValue);
      return Number.isNaN(num) ? fallback : num;
    }
    case "boolean": {
      const lower = cleanValue.toLowerCase();
      if (["true", "1", "yes", "on"].includes(lower)) return true;
      if (["false", "0", "no", "off"].includes(lower)) return false;
      return fallback;
    }
    default: return fallback;
  }
}
```

#### Pillar 4: Export (singleton)

```typescript
// src/config.ts
function initializeBackendConfig(): BackendConfig {
  const envConfig = loadBackendConfigFromEnv();
  const config = deepMerge(defaultBackendConfig, envConfig);

  const result = BackendConfigSchema.safeParse(config);
  if (!result.success) {
    throw new BackendConfigurationError("Configuration validation failed", result.error.issues);
  }
  return result.data;
}

export const backendConfig: BackendConfig = initializeBackendConfig();
```

### Key Points

- **`Bun.env`** is an object (not `process.env` which is a Proxy); it takes precedence over file-loaded vars
- **Workspace root detection** walks up the directory tree looking for `package.json` with `workspaces` key
- **Type-safe parsing** with function overloads ensures `parseEnvVar(val, "number")` returns `number`
- **Deep merge** lets env vars override individual nested fields without replacing entire sections

---

## 9. Bun Native APIs

### Pattern

Bun provides native APIs that replace common npm packages. Use them where available for better performance and fewer dependencies.

### Reference Implementation

Source: `packages/backend/src/utils/runtime.ts`

```typescript
// Runtime detection
export const isBun = (): boolean => typeof Bun !== "undefined";

// Security: Input sanitization for process spawning
export const sanitize = (input: string): string => input.replace(/[^a-zA-Z0-9\-_.]/g, "");

// Performance measurement using Bun native APIs
export async function measure<T>(_name: string, op: () => Promise<T>) {
  const start = isBun() ? Bun.nanoseconds() : performance.now() * 1_000_000;
  const result = await op();
  const ms = (isBun() ? Bun.nanoseconds() : performance.now() * 1_000_000 - start) / 1_000_000;
  return { result, ms };
}

// Safe command execution
export async function runCommand(cmd: string, args: string[]): Promise<string> {
  if (!isBun()) throw new Error("Bun.spawn() requires Bun runtime");

  const sanitizedArgs = args.map((arg) => sanitize(arg));
  const proc = Bun.spawn([cmd, ...sanitizedArgs], { stdout: "pipe" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text;
}
```

### API Reference

| API | Purpose | Node.js Equivalent |
|-----|---------|-------------------|
| `Bun.serve()` | HTTP/WebSocket server | express, fastify, http.createServer |
| `Bun.spawn()` | Process execution (promise-based) | child_process.spawn (callback) |
| `Bun.nanoseconds()` | Nanosecond-precision timing | performance.now() (ms precision) |
| `Bun.env` | Environment variables (object) | process.env (Proxy) |
| `Bun.argv` | CLI arguments array | process.argv |
| `Bun.file()` | File reference (lazy read) | fs.readFile |
| `Bun.write()` | File writing | fs.writeFile |
| `Bun.hash()` | Fast hashing | crypto.createHash |
| `import.meta.main` | Is this the entry file? | require.main === module |

### Bun.spawn() Pattern

```typescript
import { spawn } from "bun";

const proc = spawn({
  cmd: ["bun", "run", script, ...args],
  cwd: process.cwd(),
  stdout: "inherit",  // Pass through to console
  stderr: "inherit",
});

const exitCode = await proc.exited;  // Promise-based (not callback)
if (exitCode !== 0) {
  throw new Error(`Script failed with exit code ${exitCode}`);
}
```

Key differences from Node.js `child_process.spawn()`:
- Returns a promise (`proc.exited`) instead of using callbacks
- `stdout: "pipe"` returns a `ReadableStream` (Web Standards) which can be consumed via `new Response(proc.stdout).text()`
- `stdout: "inherit"` passes output directly to the parent console

### Bun.nanoseconds()

```typescript
const start = Bun.nanoseconds();
await someOperation();
const durationMs = (Bun.nanoseconds() - start) / 1_000_000;
```

Useful for database query timing, API latency measurement, and performance benchmarking where millisecond precision isn't enough.

---

## 10. CLI & Script Patterns

### Pattern

Bun makes TypeScript files directly executable. CLI scripts use manual `process.argv` parsing (no yargs/commander dependency), structured progress reporting, and consistent exit codes. The shebang `#!/usr/bin/env bun` makes scripts executable from the command line.

### Argument Parsing

No external library needed -- parse `process.argv` directly:

```typescript
#!/usr/bin/env bun

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run") || args.includes("-n"),
    verbose: args.includes("--verbose") || args.includes("-v"),
    resume: args.includes("--resume") || args.includes("-r"),
    sequential: args.includes("--sequential") || args.includes("-s"),
  };
}
```

For flags with values:

```typescript
function parseArgsWithValues() {
  const args = process.argv.slice(2);
  let accountFilter: string[] | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--account" || arg === "-a") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        console.error("Error: --account requires a value");
        process.exit(1);
      }
      accountFilter = value.split(",").map((id) => id.trim());
      i++; // Skip next arg
    }
  }

  return { accountFilter };
}
```

### Flag Conventions

| Flag | Short | Purpose |
|------|-------|---------|
| `--dry-run` | `-n` | Preview without execution |
| `--verbose` | `-v` | Detailed output |
| `--resume` | `-r` | Continue from checkpoint |
| `--sequential` | `-s` | Force sequential mode |
| `--account <ids>` | `-a` | Comma-separated filter |
| `--current` | -- | Current month only |
| `--month YYYY-MM` | -- | Specific month |

### Script Structure

```typescript
#!/usr/bin/env bun

// Parse CLI args
const options = parseArgs();

// Main logic
async function main() {
  const startTime = Date.now();

  if (options.dryRun) {
    console.log("DRY RUN MODE: No changes will be made\n");
  }

  try {
    // ... script logic
    const results = await processItems(items, options);

    // Structured summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Status: ${results.failed === 0 ? "SUCCESS" : "PARTIAL"}`);
    console.log(`Processed: ${results.success}/${results.total}`);
    console.log(`Failed: ${results.failed}`);
    console.log(`Duration: ${duration}s`);

    if (results.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main();
```

### Package.json Script Definitions

```json
{
  "scripts": {
    "sync:daily": "bun run src/scripts/sync-daily-orchestrator.ts",
    "sync:daily:resume": "bun run src/scripts/sync-daily-orchestrator.ts --resume",
    "sync:daily:dry-run": "bun run src/scripts/sync-daily-orchestrator.ts --dry-run",
    "sync:daily:sequential": "bun run src/scripts/sync-daily-orchestrator.ts --sequential",

    "sync:historical": "bun run src/scripts/sync-all-accounts-historical.ts && bun run src/database/scripts/validate-and-cleanup-duplicates.ts && bun run src/database/scripts/import-real-aws-data.ts"
  }
}
```

Script chaining with `&&` runs commands sequentially, stopping on first failure. For complex multi-step workflows, use an orchestrator script instead (see Section 12).

---

## 11. Concurrency Primitives

### Pattern

When processing many items in parallel (e.g., syncing 17 AWS accounts), you need concurrency control to avoid overwhelming external APIs. A **semaphore** limits concurrent operations while still executing them in parallel. Combined with error isolation (individual failures don't abort the batch), this provides robust parallel processing.

### Reference Implementation

Source: `packages/backend/src/utils/concurrency.ts`

```typescript
export interface ParallelOptions<T> {
  maxConcurrency: number;
  onProgress?: (completed: number, total: number, item: T, success: boolean) => void;
  onError?: (item: T, error: Error) => "continue" | "abort";
  delayBetweenBatches?: number;
}

export interface ParallelResult<T, R> {
  successful: Array<{ item: T; result: R }>;
  failed: Array<{ item: T; error: Error }>;
  totalDuration: number;
}

export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(maxConcurrency: number) {
    this.permits = maxConcurrency;
  }

  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.permits--;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.permits++;
    const next = this.waiting.shift();
    if (next) {
      next();
    }
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  getAvailablePermits(): number {
    return this.permits;
  }

  getQueueLength(): number {
    return this.waiting.length;
  }
}

export async function parallelMap<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: ParallelOptions<T>
): Promise<ParallelResult<T, R>> {
  const startTime = Date.now();
  const semaphore = new Semaphore(options.maxConcurrency);
  const successful: Array<{ item: T; result: R }> = [];
  const failed: Array<{ item: T; error: Error }> = [];
  let completed = 0;
  let aborted = false;

  const processItem = async (item: T, index: number): Promise<void> => {
    if (aborted) return;

    await semaphore.withLock(async () => {
      if (aborted) return;

      try {
        const result = await processor(item, index);
        successful.push({ item, result });
        completed++;
        options.onProgress?.(completed, items.length, item, true);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        failed.push({ item, error });
        completed++;
        options.onProgress?.(completed, items.length, item, false);

        if (options.onError?.(item, error) === "abort") {
          aborted = true;
        }
      }
    });
  };

  await Promise.all(items.map((item, index) => processItem(item, index)));

  return {
    successful,
    failed,
    totalDuration: Date.now() - startTime,
  };
}
```

### Batch Processing Variants

```typescript
// Process in fixed-size batches with optional delay between batches
export async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T, index: number) => Promise<R>,
  delayBetweenBatches?: number
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => processor(item, i + batchIndex))
    );
    results.push(...batchResults);

    if (delayBetweenBatches && i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
    }
  }

  return results;
}

// Same but with error isolation (Promise.allSettled semantics)
export async function processInBatchesSettled<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T, index: number) => Promise<R>,
  delayBetweenBatches?: number
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((item, batchIndex) => processor(item, i + batchIndex))
    );
    results.push(...batchResults);

    if (delayBetweenBatches && i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
    }
  }

  return results;
}
```

### Usage Example

```typescript
const results = await parallelMap(
  accounts,
  async (account, index) => {
    return await syncAccount(account);
  },
  {
    maxConcurrency: 5,
    onProgress: (completed, total, account, success) => {
      console.log(`[${completed}/${total}] ${account.name}: ${success ? "OK" : "FAILED"}`);
    },
    onError: (account, error) => {
      console.error(`  Error: ${error.message}`);
      return "continue"; // Don't abort on individual failures
    },
  }
);

console.log(`Success: ${results.successful.length}, Failed: ${results.failed.length}`);
```

### When to Use Which

| Pattern | Use Case |
|---------|----------|
| `parallelMap` | Process all items with concurrency limit, track success/failure per item |
| `processInBatches` | Process in waves, all must succeed (throws on first error) |
| `processInBatchesSettled` | Process in waves, isolate errors (no throws) |
| `Semaphore.withLock()` | Fine-grained locking for custom concurrent patterns |

---

## 12. Orchestration & Resumability

### Pattern

Complex workflows that run multiple scripts in stages need **checkpoint-based resumability** -- if a stage fails, you can fix the issue and resume from where it left off instead of re-running everything. The pattern: persist state to disk after each stage, load it on `--resume`.

### Stage Definitions

Source: `packages/backend/src/scripts/sync-daily-orchestrator.ts`

```typescript
interface Stage {
  name: SyncPhase;
  displayName: string;
  scripts: string[];
  parallel: boolean;
}

const STAGES: Stage[] = [
  {
    name: "accounts",
    displayName: "Stage 1: AWS Data Collection",
    scripts: [
      "src/scripts/sync-all-accounts-current-month.ts",
      "src/scripts/sync-forecasts.ts",
      "src/scripts/sync-recommendations-simple.ts",
      "src/scripts/sync-cloudwatch-metrics.ts",
      "src/scripts/sync-account-tags.ts",
    ],
    parallel: true,
  },
  {
    name: "validate",
    displayName: "Stage 2: Data Validation",
    scripts: ["src/database/scripts/validate-and-cleanup-duplicates.ts"],
    parallel: false,
  },
  {
    name: "import",
    displayName: "Stage 3: Database Import",
    scripts: ["src/database/scripts/import-current-month.ts"],
    parallel: false,
  },
  {
    name: "neo4j",
    displayName: "Stage 4: Neo4j Sync",
    scripts: ["src/database/scripts/sync-current-month-costs.ts"],
    parallel: false,
  },
  {
    name: "aggregates",
    displayName: "Stage 5: Aggregations",
    scripts: ["src/scripts/refresh-aggregates.ts"],
    parallel: false,
  },
];
```

### Script Runner

```typescript
import { spawn } from "bun";

async function runScript(
  script: string,
  dryRun: boolean
): Promise<{ success: boolean; duration: number; error?: string }> {
  const startTime = Date.now();

  if (dryRun) {
    console.log(`  [DRY RUN] Would run: ${script}`);
    return { success: true, duration: 0 };
  }

  try {
    const proc = spawn({
      cmd: ["bun", "run", script],
      cwd: process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    const duration = Date.now() - startTime;

    if (exitCode !== 0) {
      return { success: false, duration, error: `Exit code ${exitCode}` };
    }

    return { success: true, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      success: false,
      duration,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

### Stage Execution (Parallel or Sequential)

```typescript
async function runStage(stage: Stage, state: SyncState, options: OrchestratorOptions) {
  setCurrentPhase(state, stage.name);
  await saveSyncState(state);

  if (stage.parallel && !options.sequential && stage.scripts.length > 1) {
    // Parallel execution
    const promises = stage.scripts.map(async (script) => {
      return { script, result: await runScript(script, options.dryRun) };
    });
    const results = await Promise.all(promises);
    // ... handle results
  } else {
    // Sequential execution -- stop on first error
    for (const script of stage.scripts) {
      const result = await runScript(script, options.dryRun);
      if (!result.success) break;
    }
  }

  markPhaseComplete(state, stage.name, duration);
  await saveSyncState(state);
}
```

### State Persistence

Source: `packages/backend/src/utils/sync-state.ts`

```typescript
export type SyncPhase =
  | "accounts" | "forecasts" | "recommendations" | "cloudwatch"
  | "validate" | "import" | "neo4j" | "aggregates" | "complete";

export interface SyncState {
  syncId: string;
  startedAt: string;
  lastUpdated: string;
  phase: SyncPhase;
  completedPhases: SyncPhase[];
  completedAccounts: Record<SyncPhase, string[]>;
  failedAccounts: FailedAccount[];
  metrics: {
    totalDuration: number;
    phaseDurations: Record<SyncPhase, number>;
    accountDurations: Record<string, number>;
  };
}

export function createSyncState(): SyncState {
  return {
    syncId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    phase: "accounts",
    completedPhases: [],
    completedAccounts: { /* ... initialized empty arrays ... */ },
    failedAccounts: [],
    metrics: { totalDuration: 0, phaseDurations: {}, accountDurations: {} },
  };
}

export async function saveSyncState(state: SyncState, baseDir = process.cwd()): Promise<void> {
  const stateDir = join(baseDir, "data/.sync-state");
  await fs.mkdir(stateDir, { recursive: true });

  state.lastUpdated = new Date().toISOString();

  // Save by sync ID (for history)
  await fs.writeFile(join(stateDir, `${state.syncId}.json`), JSON.stringify(state, null, 2));

  // Also save as latest (for quick resume lookup)
  await fs.writeFile(join(stateDir, "latest.json"), JSON.stringify(state, null, 2));
}

export async function getResumableState(baseDir = process.cwd()): Promise<SyncState | null> {
  try {
    const content = await fs.readFile(join(baseDir, "data/.sync-state/latest.json"), "utf-8");
    const state = JSON.parse(content) as SyncState;

    // Only resume if not complete and less than 24h old
    if (state.phase !== "complete") {
      const age = Date.now() - new Date(state.lastUpdated).getTime();
      if (age < 24 * 60 * 60 * 1000) {
        return state;
      }
    }
    return null;
  } catch {
    return null;
  }
}
```

### Resume Logic

```typescript
let state: SyncState;
let startStageIndex = 0;

if (options.resume) {
  const existing = await getResumableState();
  if (existing) {
    state = existing;

    // Find the stage to resume from
    const currentPhaseIndex = STAGES.findIndex((s) => s.name === state.phase);
    if (currentPhaseIndex !== -1 && !state.completedPhases.includes(state.phase)) {
      startStageIndex = currentPhaseIndex; // Re-run failed stage
    } else {
      startStageIndex = currentPhaseIndex + 1; // Skip to next
    }
  } else {
    state = createSyncState(); // No resumable state, start fresh
  }
} else {
  state = createSyncState();
}
```

### Key Design Points

- **Dual save**: Both by sync ID (audit trail) and as `latest.json` (fast lookup)
- **24-hour window**: States older than 24 hours are not resumable (data may have changed)
- **Per-account tracking**: `completedAccounts` tracks which accounts succeeded per phase
- **Metrics**: Duration per phase and per account for performance analysis
- **Cleanup**: `cleanupOldStates(maxAgeDays)` removes stale checkpoint files

---

## 13. SvelteKit + Bun

### Pattern

SvelteKit uses Vite as its build tool and can run on Bun as the underlying runtime. In a Bun monorepo, the frontend package uses `catalog:` version references from the workspace and Bun to execute Vite commands.

### SvelteKit Configuration

Source: `packages/frontend/svelte.config.js`

```javascript
import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
  preprocess: vitePreprocess(),

  compilerOptions: {
    runes: true
  },

  kit: {
    adapter: adapter()
  }
};

export default config;
```

### Vite Configuration

Source: `packages/frontend/vite.config.ts`

```typescript
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit()
  ],
  server: {
    host: true
  },
  preview: {
    host: true
  }
});
```

### Frontend Package

Source: `packages/frontend/package.json`

```json
{
  "name": "@aws-cost-analyzer/frontend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch",
    "typecheck": "bun run check"
  },
  "dependencies": {
    "@shimmer-from-structure/svelte": "^2.3.4",
    "echarts": "^6.0.0",
    "highlight.js": "^11.11.1",
    "marked": "^17.0.4"
  },
  "devDependencies": {
    "@sveltejs/adapter-auto": "^7.0.1",
    "@sveltejs/kit": "catalog:frontend",
    "@sveltejs/vite-plugin-svelte": "catalog:frontend",
    "@tailwindcss/vite": "^4.2.1",
    "svelte": "catalog:frontend",
    "svelte-check": "^4.4.5",
    "tailwindcss": "^4.2.1",
    "typescript": "catalog:",
    "vite": "catalog:frontend"
  }
}
```

### Frontend TypeScript Config

Source: `packages/frontend/tsconfig.json`

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

### How It Fits Together

| Concern | How |
|---------|-----|
| Package manager | Bun installs all deps (`bun install` at root) |
| Version pinning | `catalog:frontend` references in `package.json` |
| Dev server | `vite dev` (Vite handles SvelteKit HMR) |
| TypeScript | Extends SvelteKit's auto-generated tsconfig |
| Styling | Tailwind CSS v4 via Vite plugin (not PostCSS) |
| Svelte 5 | Runes enabled via `compilerOptions.runes: true` |
| API communication | `import.meta.env.VITE_API_URL` for backend URL discovery |
| Dual dev | `concurrently "bun run api" "bun run frontend"` starts both |

### API URL Discovery

The frontend discovers the backend URL via Vite environment variables:

```typescript
// src/lib/services/organizational-service.ts
const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
```

Set `VITE_API_URL` in `.env` at the project root for custom backend URLs. Vite exposes only variables prefixed with `VITE_` to client code.

---

## 14. Code Quality Toolchain

### Pattern

**Biome** replaces ESLint + Prettier as a single tool for linting and formatting. It's significantly faster (written in Rust) and eliminates the configuration complexity of managing two tools. In a Bun monorepo, a single `biome.json` at the root governs all packages.

### Reference Implementation

Source: `/biome.json`

> **Note:** The `includes` paths and `overrides` paths below are project-specific examples from the AWS Cost Analyzer monorepo. Replace `packages/backend/src/...` paths with your own project structure. The linter rules, formatter settings, and globals configuration are reusable as-is.

```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.15/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": false,
    "includes": [
      "packages/backend/src/**/*.ts",  // Replace with your project paths
      "*.ts",
      "*.js",
      "*.json",
      "!!**/node_modules/**/*",
      "!!**/dist/**/*",
      "!!**/.git/**/*",
      "!!**/data/**/*",
      "!!**/implementation/**/*"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineEnding": "lf",
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUndeclaredVariables": "off",
        "noUnusedVariables": "warn",
        "noUnusedPrivateClassMembers": "warn",
        "noConstAssign": "error"
      },
      "style": {
        "noNamespace": "error",
        "noNonNullAssertion": "warn",
        "useAsConstAssertion": "error",
        "useImportType": "error",
        "useNodejsImportProtocol": "error",
        "useNumberNamespace": "error",
        "useConsistentArrayType": "error",
        "useExportType": "error"
      },
      "suspicious": {
        "noExplicitAny": "warn",
        "noImplicitAnyLet": "warn",
        "noDebugger": "error",
        "noConsole": "warn",
        "noEmptyInterface": "warn",
        "useIterableCallbackReturn": "warn"
      },
      "security": {
        "noGlobalEval": "error"
      },
      "complexity": {
        "noExcessiveCognitiveComplexity": {
          "level": "warn",
          "options": { "maxAllowedComplexity": 35 }
        },
        "useLiteralKeys": "warn"
      },
      "performance": {
        "noAccumulatingSpread": "warn",
        "noDelete": "warn"
      }
    }
  },
  "javascript": {
    "globals": ["Bun", "Timer", "process", "Buffer"],
    "formatter": {
      "quoteStyle": "double",
      "trailingCommas": "es5",
      "semicolons": "always",
      "arrowParentheses": "always",
      "bracketSpacing": true
    }
  },
  "json": {
    "parser": { "allowComments": true },
    "formatter": { "trailingCommas": "none" }
  },
  "overrides": [
    {
      "includes": ["packages/backend/src/config/**/*"],  // Replace with your project paths
      "formatter": { "lineWidth": 120 }
    },
    {
      "includes": [
        // Replace with your project paths where console output is legitimate
        "packages/backend/src/utils/logger.ts",
        "packages/backend/src/ai/graph/**/*",
        "packages/backend/src/scripts/**/*",
        "packages/backend/src/database/scripts/**/*",
        "packages/backend/src/cli/**/*",
        "packages/backend/src/index.ts",
        "packages/backend/src/services/**/*"
      ],
      "linter": {
        "rules": {
          "suspicious": { "noConsole": "off" }
        }
      }
    }
  ]
}
```

### Key Configuration Decisions

| Rule | Setting | Why |
|------|---------|-----|
| `useNodejsImportProtocol` | `error` | Forces `import { join } from "node:path"` not `"path"` |
| `useImportType` | `error` | Forces `import type { ... }` for type-only imports |
| `noConsole` | `warn` + overrides | Warns in library code but allowed in scripts/AI/server |
| `noExplicitAny` | `warn` | Discourages `any` without blocking pragmatic use |
| `noExcessiveCognitiveComplexity` | `35` | Catches overly complex functions |
| `noUndeclaredVariables` | `off` | Bun globals (`Bun`, `process`) would trigger false positives; the `globals` array handles runtime, but this rule must be off |
| `globals` | `["Bun", "Timer", "process", "Buffer"]` | Declares Bun runtime globals for the formatter/parser |

### Path-Based Overrides

The `noConsole` rule illustrates Biome's path-based override system:

- **Default**: `noConsole: "warn"` -- most code shouldn't use console.log
- **Override paths**: Scripts, CLI, server entry, AI graph, services -- these legitimately need console output

### Workspace Scripts

```json
{
  "biome:check": "biome check .",
  "biome:check:write": "biome check --write .",
  "biome:ci": "biome ci .",
  "quality:check": "bun run biome:check && bun run typecheck",
  "quality:fix": "bun run biome:check:write && bun run typecheck"
}
```

- `biome check` -- lint + format check (exit 1 on violations)
- `biome check --write` -- auto-fix what's fixable
- `biome ci` -- CI-optimized mode (no fixes, just report)

---

## 15. Build, Dev & Deployment

### Pattern

Bun provides built-in bundling (`bun build`), hot reloading (`bun --hot`), and fast script execution. Combined with `concurrently` for multi-server development, this creates a zero-config development experience.

### Development

```bash
# Start both backend and frontend
bun run dev:full
# Runs: concurrently "bun run api" "bun run frontend"

# Backend only (with hot reloading)
bun --hot packages/backend/src/index.ts

# Frontend only (Vite dev server)
bun run --filter='@aws-cost-analyzer/frontend' dev
```

#### Hot Module Replacement

Two levels of HMR:

1. **`bun --hot`** (CLI flag): Watches for file changes and reloads modules without restarting the process. State is preserved.

2. **`development.hmr: true`** (in `Bun.serve()`): Enables server-side HMR for the HTTP server specifically. Combined with `development.console: true` for enhanced development logging.

```json
// package.json
{
  "dev": "bun --hot src/index.ts"
}
```

```typescript
// In Bun.serve()
Bun.serve({
  development: {
    hmr: true,
    console: true,
  },
});
```

### Building

```bash
# Build backend for production
bun build src/index.ts --outdir=./dist --target=bun --minify
```

| Flag | Purpose |
|------|---------|
| `--target=bun` | Optimize for Bun runtime (not browser/node) |
| `--minify` | Minify output for smaller bundle |
| `--outdir=./dist` | Output directory |

### Multi-Package Operations

```bash
# Type check all packages
bun run --recursive typecheck

# Build all packages
bun run --filter='packages/*' build

# Run tests recursively
bun test --recursive

# Quality check (lint + typecheck)
bun run quality:check
```

### Graceful Shutdown

```typescript
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await dbManager.disconnect();
  process.exit(0);
});
```

Always clean up database connections and other resources on SIGINT. This is critical for development (Ctrl+C) and production (container stop signals).

### Process Management Rules

1. **Check ports before starting**: `lsof -i :3000` to avoid EADDRINUSE
2. **Trust HMR**: Don't kill running servers to apply changes -- Bun reloads modules automatically
3. **Kill background processes**: Always clean up after testing
4. **Use timeouts**: Wrap long-running operations with timeout constraints

### Deployment Checklist

- [ ] `bun build` with `--target=bun --minify`
- [ ] Environment variables set (see Section 8)
- [ ] `bun.lock` committed (reproducible installs)
- [ ] `biome ci` passes (no lint/format violations)
- [ ] TypeScript compiles (`bun run typecheck`)
- [ ] Graceful shutdown handles SIGINT and SIGTERM
- [ ] `idleTimeout` set appropriately for SSE endpoints
- [ ] Health check endpoint responds on `/api/health`
