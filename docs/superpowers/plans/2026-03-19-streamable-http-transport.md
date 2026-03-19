# Streamable HTTP Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Streamable HTTP transport alongside existing stdio, enabling remote multi-client MCP access via `Bun.serve()` with zero new dependencies.

**Architecture:** Transport factory pattern selects stdio, HTTP, or both based on `MCP_TRANSPORT` env var. HTTP mode uses `Bun.serve()` with `WebStandardStreamableHTTPServerTransport` from the existing MCP SDK. Security via HOF middleware wrappers (`withOriginValidation`, `withApiKeyAuth`). Server creation extracted into a factory function so HTTP can create per-request instances (stateless) or reuse per-session (stateful).

**Tech Stack:** Bun runtime, `@modelcontextprotocol/sdk` (already installed), `WebStandardStreamableHTTPServerTransport`, Zod v4, Pino logging.

**Linear Epic:** [SIO-526](https://linear.app/siobytes/issue/SIO-526/epic-2-streamable-http-transport)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/transport/stdio.ts` | StdioServerTransport lifecycle (extracted from index.ts) |
| `src/transport/http.ts` | `Bun.serve()` + `WebStandardStreamableHTTPServerTransport` (stateless + stateful) |
| `src/transport/middleware.ts` | HOF security wrappers: `withOriginValidation()`, `withApiKeyAuth()` |
| `src/transport/factory.ts` | Transport selection based on config, composes start/stop lifecycle |
| `src/transport/index.ts` | Barrel exports for transport module |
| `src/transport/__tests__/middleware.test.ts` | Tests for HOF security wrappers |
| `src/transport/__tests__/factory.test.ts` | Tests for transport factory selection |
| `src/transport/__tests__/http.test.ts` | Tests for HTTP transport |
| `src/config/__tests__/transport-config.test.ts` | Tests for transport config validation |

### Modified Files

| File | Change |
|------|--------|
| `src/config/defaults.ts` | Add `transport` section with safe defaults |
| `src/config/env-mapping.ts` | Add `MCP_*` env var mappings |
| `src/config/schemas.ts` | Add `transportSchema`, extend `configSchema` |
| `src/config/loader.ts` | Add transport boolean/number paths |
| `src/config/index.ts` | Re-export transport types |
| `src/index.ts` | Extract server factory, delegate to transport factory |

---

## Task 1: Transport Config Extension (SIO-527)

**Files:**
- Modify: `src/config/defaults.ts`
- Modify: `src/config/env-mapping.ts`
- Modify: `src/config/schemas.ts`
- Modify: `src/config/loader.ts`
- Modify: `src/config/index.ts`
- Test: `src/config/__tests__/transport-config.test.ts`

- [ ] **Step 1: Write failing test for transport config defaults**

```typescript
// src/config/__tests__/transport-config.test.ts
import { describe, expect, test, afterEach } from "bun:test";
import { resetConfigCache } from "../config.ts";

describe("transport config", () => {
  afterEach(() => {
    resetConfigCache();
  });

  test("defaults to stdio transport", () => {
    const { getConfig } = require("../config.ts");
    const config = getConfig();
    expect(config.transport.mode).toBe("stdio");
  });

  test("defaults to port 3000", () => {
    const { getConfig } = require("../config.ts");
    const config = getConfig();
    expect(config.transport.port).toBe(3000);
  });

  test("defaults to localhost binding", () => {
    const { getConfig } = require("../config.ts");
    const config = getConfig();
    expect(config.transport.host).toBe("127.0.0.1");
  });

  test("defaults to /mcp path", () => {
    const { getConfig } = require("../config.ts");
    const config = getConfig();
    expect(config.transport.path).toBe("/mcp");
  });

  test("defaults to stateless session mode", () => {
    const { getConfig } = require("../config.ts");
    const config = getConfig();
    expect(config.transport.sessionMode).toBe("stateless");
  });

  test("defaults to 120s idle timeout", () => {
    const { getConfig } = require("../config.ts");
    const config = getConfig();
    expect(config.transport.idleTimeout).toBe(120);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/config/__tests__/transport-config.test.ts`
Expected: FAIL -- `config.transport` is undefined

- [ ] **Step 3: Add transport defaults**

```typescript
// src/config/defaults.ts -- add to the defaults object
  transport: {
    mode: "stdio" as const,
    port: 3000,
    host: "127.0.0.1",
    path: "/mcp",
    sessionMode: "stateless" as const,
    apiKey: "",
    allowedOrigins: "",
    idleTimeout: 120,
  },
```

- [ ] **Step 4: Add transport env var mappings**

```typescript
// src/config/env-mapping.ts -- add to the envMapping object
  MCP_TRANSPORT: "transport.mode",
  MCP_PORT: "transport.port",
  MCP_HOST: "transport.host",
  MCP_PATH: "transport.path",
  MCP_SESSION_MODE: "transport.sessionMode",
  MCP_API_KEY: "transport.apiKey",
  MCP_ALLOWED_ORIGINS: "transport.allowedOrigins",
  MCP_IDLE_TIMEOUT: "transport.idleTimeout",
```

- [ ] **Step 5: Add transport Zod schema**

```typescript
// src/config/schemas.ts -- add before configSchema

export const transportSchema = z.object({
  mode: z.enum(["stdio", "http", "both"]).describe("Transport mode"),
  port: z.number().int().min(1024).max(65535).describe("HTTP server port"),
  host: z.string().describe("HTTP server bind address"),
  path: z.string().startsWith("/").describe("MCP endpoint path"),
  sessionMode: z.enum(["stateless", "stateful"]).describe("HTTP session mode"),
  apiKey: z.string().describe("Optional API key for Bearer token auth"),
  allowedOrigins: z.string().describe("Comma-separated allowed origins"),
  idleTimeout: z.number().int().min(10).max(255).describe("Bun.serve() idle timeout in seconds"),
});

// Add transport to configSchema .object():
//   transport: transportSchema,
```

- [ ] **Step 6: Update loader with transport number paths**

```typescript
// src/config/loader.ts -- add to numberPaths Set
  "transport.port",
  "transport.idleTimeout",
```

- [ ] **Step 7: Update config index exports**

No change needed -- `AppConfig` type is inferred from `configSchema` which now includes `transport`.

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test src/config/__tests__/transport-config.test.ts`
Expected: PASS -- all 6 tests pass

- [ ] **Step 9: Run full test suite and typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: All pass, no type errors

- [ ] **Step 10: Commit**

```bash
git add src/config/ src/config/__tests__/
git commit -m "SIO-527: Add transport config to 4-pillar config system"
```

---

## Task 2: Security HOF Middleware (SIO-531)

**Files:**
- Create: `src/transport/middleware.ts`
- Test: `src/transport/__tests__/middleware.test.ts`

- [ ] **Step 1: Write failing tests for origin validation**

```typescript
// src/transport/__tests__/middleware.test.ts
import { describe, expect, test } from "bun:test";
import { withOriginValidation, withApiKeyAuth } from "../middleware.ts";

const okHandler = async (_req: Request) => Response.json({ ok: true });

describe("withOriginValidation", () => {
  test("passes when no Origin header present", async () => {
    const handler = withOriginValidation(okHandler, ["http://allowed.com"]);
    const res = await handler(new Request("http://localhost/mcp", { method: "POST" }));
    expect(res.status).toBe(200);
  });

  test("passes when origin is in allowed list", async () => {
    const handler = withOriginValidation(okHandler, ["http://allowed.com"]);
    const res = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { Origin: "http://allowed.com" },
      }),
    );
    expect(res.status).toBe(200);
  });

  test("blocks when origin is not in allowed list", async () => {
    const handler = withOriginValidation(okHandler, ["http://allowed.com"]);
    const res = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { Origin: "http://evil.com" },
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toBe("Origin not allowed");
  });

  test("passes all origins when no allowed list configured", async () => {
    const handler = withOriginValidation(okHandler);
    const res = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { Origin: "http://anything.com" },
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("withApiKeyAuth", () => {
  test("passes when no API key configured", async () => {
    const handler = withApiKeyAuth(okHandler);
    const res = await handler(new Request("http://localhost/mcp", { method: "POST" }));
    expect(res.status).toBe(200);
  });

  test("passes when Bearer token matches", async () => {
    const handler = withApiKeyAuth(okHandler, "secret-key");
    const res = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { Authorization: "Bearer secret-key" },
      }),
    );
    expect(res.status).toBe(200);
  });

  test("blocks when Bearer token is missing", async () => {
    const handler = withApiKeyAuth(okHandler, "secret-key");
    const res = await handler(new Request("http://localhost/mcp", { method: "POST" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toBe("Unauthorized");
  });

  test("blocks when Bearer token is wrong", async () => {
    const handler = withApiKeyAuth(okHandler, "secret-key");
    const res = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-key" },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("middleware composition", () => {
  test("origin checked before auth", async () => {
    const handler = withApiKeyAuth(
      withOriginValidation(okHandler, ["http://allowed.com"]),
      "secret-key",
    );
    const res = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          Origin: "http://evil.com",
          Authorization: "Bearer secret-key",
        },
      }),
    );
    // Auth passes but origin fails -- outermost wrapper (apiKey) runs first,
    // passes to inner (origin) which blocks
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/transport/__tests__/middleware.test.ts`
Expected: FAIL -- cannot resolve `../middleware.ts`

- [ ] **Step 3: Implement middleware HOFs**

```typescript
// src/transport/middleware.ts
type RouteHandler = (req: Request) => Promise<Response> | Response;

export function withOriginValidation(
  handler: RouteHandler,
  allowedOrigins?: string[],
): RouteHandler {
  return async (req: Request) => {
    const origin = req.headers.get("origin");
    if (!origin) return handler(req);

    if (allowedOrigins && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Origin not allowed" }, id: null },
        { status: 403 },
      );
    }
    return handler(req);
  };
}

export function withApiKeyAuth(handler: RouteHandler, apiKey?: string): RouteHandler {
  return async (req: Request) => {
    if (!apiKey) return handler(req);

    const header = req.headers.get("authorization");
    if (header !== `Bearer ${apiKey}`) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized" }, id: null },
        { status: 401 },
      );
    }
    return handler(req);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/transport/__tests__/middleware.test.ts`
Expected: PASS -- all 9 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/transport/middleware.ts src/transport/__tests__/middleware.test.ts
git commit -m "SIO-531: Add security HOF middleware (withOriginValidation, withApiKeyAuth)"
```

---

## Task 3: Stdio Transport Extraction (SIO-528 part 1)

**Files:**
- Create: `src/transport/stdio.ts`

- [ ] **Step 1: Create stdio transport module**

Extract the stdio transport setup from `src/index.ts` into its own module. This is a direct extraction -- behavior is identical.

```typescript
// src/transport/stdio.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getLogger } from "../logging/container.ts";

export interface StdioTransportResult {
  transport: StdioServerTransport;
  close(): Promise<void>;
}

export async function startStdioTransport(server: McpServer): Promise<StdioTransportResult> {
  const logger = getLogger();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP server connected via stdio");

  return {
    transport,
    async close() {
      try {
        await transport.close();
        logger.info("Stdio transport closed");
      } catch (error) {
        logger.error("Error closing stdio transport", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/transport/stdio.ts
git commit -m "SIO-528: Extract stdio transport into src/transport/stdio.ts"
```

---

## Task 4: HTTP Transport Implementation (SIO-529 + SIO-530)

**Files:**
- Create: `src/transport/http.ts`
- Test: `src/transport/__tests__/http.test.ts`

- [ ] **Step 1: Write failing test for HTTP transport**

```typescript
// src/transport/__tests__/http.test.ts
import { describe, expect, test, afterEach } from "bun:test";

describe("HTTP transport", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;

  afterEach(() => {
    if (server) {
      server.stop(true);
      server = null;
    }
  });

  test("GET /mcp returns 405 in stateless mode", async () => {
    const { startHttpTransport } = await import("../http.ts");
    const result = await startHttpTransport(
      () => {
        throw new Error("should not create server for GET");
      },
      { port: 0, host: "127.0.0.1", path: "/mcp", sessionMode: "stateless" as const, idleTimeout: 10 },
    );
    server = result.server;
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: "GET" });
    expect(res.status).toBe(405);
    await result.close();
  });

  test("DELETE /mcp returns 405 in stateless mode", async () => {
    const { startHttpTransport } = await import("../http.ts");
    const result = await startHttpTransport(
      () => {
        throw new Error("should not create server for DELETE");
      },
      { port: 0, host: "127.0.0.1", path: "/mcp", sessionMode: "stateless" as const, idleTimeout: 10 },
    );
    server = result.server;
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: "DELETE" });
    expect(res.status).toBe(405);
    await result.close();
  });

  test("404 for unknown paths", async () => {
    const { startHttpTransport } = await import("../http.ts");
    const result = await startHttpTransport(
      () => {
        throw new Error("should not create server");
      },
      { port: 0, host: "127.0.0.1", path: "/mcp", sessionMode: "stateless" as const, idleTimeout: 10 },
    );
    server = result.server;
    const res = await fetch(`http://127.0.0.1:${server.port}/unknown`);
    expect(res.status).toBe(404);
    await result.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/transport/__tests__/http.test.ts`
Expected: FAIL -- cannot resolve `../http.ts`

- [ ] **Step 3: Implement HTTP transport**

```typescript
// src/transport/http.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getLogger } from "../logging/container.ts";
import { withApiKeyAuth, withOriginValidation } from "./middleware.ts";

interface HttpTransportConfig {
  port: number;
  host: string;
  path: string;
  sessionMode: "stateless" | "stateful";
  idleTimeout: number;
  apiKey?: string;
  allowedOrigins?: string[];
}

type ServerFactory = () => McpServer;

interface SessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
}

export interface HttpTransportResult {
  server: ReturnType<typeof Bun.serve>;
  close(): Promise<void>;
}

function createStatelessHandler(serverFactory: ServerFactory) {
  return async (req: Request): Promise<Response> => {
    const logger = getLogger();
    const server = serverFactory();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);

    try {
      return await transport.handleRequest(req);
    } catch (error) {
      logger.error("Stateless request error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Internal server error" }, id: null },
        { status: 500 },
      );
    }
  };
}

function createStatefulHandlers(serverFactory: ServerFactory) {
  const sessions = new Map<string, SessionEntry>();

  async function handlePost(req: Request): Promise<Response> {
    const logger = getLogger();
    const sessionId = req.headers.get("mcp-session-id");

    if (sessionId && sessions.has(sessionId)) {
      return sessions.get(sessionId)!.transport.handleRequest(req);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        logger.info("Session initialized", { sessionId: id });
      },
    });

    const server = serverFactory();
    await server.connect(transport);

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        logger.info("Session closed", { sessionId: transport.sessionId });
      }
    };

    const response = await transport.handleRequest(req);

    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport, server });
    }

    return response;
  }

  async function handleGet(req: Request): Promise<Response> {
    const sessionId = req.headers.get("mcp-session-id");
    if (!sessionId || !sessions.has(sessionId)) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Bad request: no valid session" }, id: null },
        { status: 400 },
      );
    }
    return sessions.get(sessionId)!.transport.handleRequest(req);
  }

  async function handleDelete(req: Request): Promise<Response> {
    const sessionId = req.headers.get("mcp-session-id");
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.close();
      await session.server.close();
      sessions.delete(sessionId);
      return new Response(null, { status: 200 });
    }
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Bad request: no valid session" }, id: null },
      { status: 400 },
    );
  }

  async function closeAll(): Promise<void> {
    const logger = getLogger();
    const count = sessions.size;
    for (const [id, session] of sessions) {
      try {
        await session.transport.close();
        await session.server.close();
      } catch {
        // Best effort cleanup
      }
      sessions.delete(id);
    }
    logger.info("All sessions closed", { count });
  }

  return { handlePost, handleGet, handleDelete, closeAll };
}

export async function startHttpTransport(
  serverFactory: ServerFactory,
  config: HttpTransportConfig,
): Promise<HttpTransportResult> {
  const logger = getLogger();
  const isStateful = config.sessionMode === "stateful";

  const methodNotAllowed = () =>
    Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null },
      { status: 405 },
    );

  let postHandler: (req: Request) => Promise<Response>;
  let getHandler: (req: Request) => Promise<Response> | Response;
  let deleteHandler: (req: Request) => Promise<Response> | Response;
  let closeAllSessions: (() => Promise<void>) | undefined;

  if (isStateful) {
    const handlers = createStatefulHandlers(serverFactory);
    postHandler = handlers.handlePost;
    getHandler = handlers.handleGet;
    deleteHandler = handlers.handleDelete;
    closeAllSessions = handlers.closeAll;
  } else {
    postHandler = createStatelessHandler(serverFactory);
    getHandler = methodNotAllowed;
    deleteHandler = methodNotAllowed;
  }

  // Apply security middleware
  const securedPost = withApiKeyAuth(
    withOriginValidation(postHandler, config.allowedOrigins),
    config.apiKey,
  );
  const securedGet = withApiKeyAuth(
    withOriginValidation(getHandler, config.allowedOrigins),
    config.apiKey,
  );
  const securedDelete = withApiKeyAuth(
    withOriginValidation(deleteHandler, config.allowedOrigins),
    config.apiKey,
  );

  const httpServer = Bun.serve({
    port: config.port,
    hostname: config.host,
    idleTimeout: config.idleTimeout,

    routes: {
      [`${config.path}`]: {
        POST: securedPost,
        GET: securedGet,
        DELETE: securedDelete,
      },
    },

    fetch: async () => {
      return Response.json({ error: "Not found" }, { status: 404 });
    },

    error: (error) => {
      logger.error("HTTP server error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Internal server error" }, id: null },
        { status: 500 },
      );
    },
  });

  logger.info(`MCP server started (HTTP ${config.sessionMode} mode)`, {
    url: `http://${config.host}:${httpServer.port}${config.path}`,
    sessionMode: config.sessionMode,
  });

  return {
    server: httpServer,
    async close() {
      if (closeAllSessions) {
        await closeAllSessions();
      }
      httpServer.stop(true);
      logger.info("HTTP transport closed");
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/transport/__tests__/http.test.ts`
Expected: PASS -- all 3 tests pass

- [ ] **Step 5: Add stateful mode tests**

```typescript
// src/transport/__tests__/http.test.ts -- add to the describe block

describe("HTTP transport stateful mode", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;

  afterEach(() => {
    if (server) {
      server.stop(true);
      server = null;
    }
  });

  test("GET /mcp returns 400 without session ID in stateful mode", async () => {
    const { startHttpTransport } = await import("../http.ts");
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const result = await startHttpTransport(
      () => new McpServer({ name: "test", version: "0.1.0" }),
      { port: 0, host: "127.0.0.1", path: "/mcp", sessionMode: "stateful" as const, idleTimeout: 10 },
    );
    server = result.server;
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: "GET" });
    expect(res.status).toBe(400);
    await result.close();
  });

  test("DELETE /mcp returns 400 without valid session in stateful mode", async () => {
    const { startHttpTransport } = await import("../http.ts");
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const result = await startHttpTransport(
      () => new McpServer({ name: "test", version: "0.1.0" }),
      { port: 0, host: "127.0.0.1", path: "/mcp", sessionMode: "stateful" as const, idleTimeout: 10 },
    );
    server = result.server;
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "DELETE",
      headers: { "mcp-session-id": "nonexistent-session" },
    });
    expect(res.status).toBe(400);
    await result.close();
  });

  test("POST /mcp initializes a session in stateful mode", async () => {
    const { startHttpTransport } = await import("../http.ts");
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const result = await startHttpTransport(
      () => {
        const s = new McpServer({ name: "test", version: "0.1.0" });
        return s;
      },
      { port: 0, host: "127.0.0.1", path: "/mcp", sessionMode: "stateful" as const, idleTimeout: 10 },
    );
    server = result.server;
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test-client", version: "0.1.0" },
        },
      }),
    });
    // Should get a response with mcp-session-id header
    expect(res.status).toBe(200);
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    await result.close();
  });
});
```

- [ ] **Step 6: Run all HTTP tests**

Run: `bun test src/transport/__tests__/http.test.ts`
Expected: PASS -- all 6 tests pass (3 stateless + 3 stateful)

- [ ] **Step 7: Commit**

```bash
git add src/transport/http.ts src/transport/__tests__/http.test.ts
git commit -m "SIO-529: Implement HTTP transport with Bun.serve() + WebStandardStreamableHTTPServerTransport"
```

---

## Task 5: Transport Factory (SIO-528 part 2)

**Files:**
- Create: `src/transport/factory.ts`
- Test: `src/transport/__tests__/factory.test.ts`

- [ ] **Step 1: Write failing test for transport factory**

```typescript
// src/transport/__tests__/factory.test.ts
import { describe, expect, test } from "bun:test";
import { resolveTransportMode } from "../factory.ts";

describe("resolveTransportMode", () => {
  test("returns stdio for stdio mode", () => {
    expect(resolveTransportMode("stdio")).toEqual({ stdio: true, http: false });
  });

  test("returns http for http mode", () => {
    expect(resolveTransportMode("http")).toEqual({ stdio: false, http: true });
  });

  test("returns both for both mode", () => {
    expect(resolveTransportMode("both")).toEqual({ stdio: true, http: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/transport/__tests__/factory.test.ts`
Expected: FAIL -- cannot resolve `../factory.ts`

- [ ] **Step 3: Implement transport factory**

```typescript
// src/transport/factory.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config/schemas.ts";
import { splitCommaSeparated } from "../config/helpers.ts";
import { getLogger } from "../logging/container.ts";
import type { HttpTransportResult } from "./http.ts";
import { startHttpTransport } from "./http.ts";
import type { StdioTransportResult } from "./stdio.ts";
import { startStdioTransport } from "./stdio.ts";

export interface TransportResult {
  stdio?: StdioTransportResult;
  http?: HttpTransportResult;
  closeAll(): Promise<void>;
}

export function resolveTransportMode(mode: string): { stdio: boolean; http: boolean } {
  switch (mode) {
    case "http":
      return { stdio: false, http: true };
    case "both":
      return { stdio: true, http: true };
    default:
      return { stdio: true, http: false };
  }
}

export async function createTransport(
  config: AppConfig,
  serverFactory: () => McpServer,
): Promise<TransportResult> {
  const logger = getLogger();
  const { stdio: useStdio, http: useHttp } = resolveTransportMode(config.transport.mode);

  const result: TransportResult = {
    async closeAll() {
      if (result.http) await result.http.close();
      if (result.stdio) await result.stdio.close();
    },
  };

  if (useHttp) {
    const allowedOrigins = splitCommaSeparated(config.transport.allowedOrigins || undefined);
    result.http = await startHttpTransport(serverFactory, {
      port: config.transport.port,
      host: config.transport.host,
      path: config.transport.path,
      sessionMode: config.transport.sessionMode,
      idleTimeout: config.transport.idleTimeout,
      apiKey: config.transport.apiKey || undefined,
      allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : undefined,
    });
  }

  if (useStdio) {
    const server = serverFactory();
    result.stdio = await startStdioTransport(server);
  }

  logger.info("Transport initialized", {
    mode: config.transport.mode,
    stdio: useStdio,
    http: useHttp,
  });

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/transport/__tests__/factory.test.ts`
Expected: PASS -- all 3 tests pass

- [ ] **Step 5: Create barrel export**

```typescript
// src/transport/index.ts
export { createTransport, resolveTransportMode, type TransportResult } from "./factory.ts";
export { startHttpTransport, type HttpTransportResult } from "./http.ts";
export { startStdioTransport, type StdioTransportResult } from "./stdio.ts";
export { withApiKeyAuth, withOriginValidation } from "./middleware.ts";
```

- [ ] **Step 6: Update src/index.ts import to use barrel**

Change: `import { createTransport } from "./transport/factory.ts";`
To: `import { createTransport } from "./transport/index.ts";`

- [ ] **Step 7: Commit**

```bash
git add src/transport/index.ts src/transport/factory.ts src/transport/__tests__/factory.test.ts
git commit -m "SIO-528: Add transport factory with mode resolution and barrel export"
```

---

## Task 6: Entry Point Refactor (SIO-532)

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Extract server factory and wire transport factory**

Replace the current `src/index.ts` with the refactored version that uses the transport factory. The server creation logic (steps 1-8) stays the same. Steps 9-10 (transport + shutdown) use the new factory.

```typescript
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NodeSDK } from "@opentelemetry/sdk-node";
import { getConfig } from "./config/index.ts";
import { getLogger, setLogger } from "./logging/container.ts";
import { createLogger } from "./logging/create-logger.ts";
import { createProvider } from "./providers/factory.ts";
import { KafkaClientManager } from "./services/client-manager.ts";
import { KafkaService } from "./services/kafka-service.ts";
import { KsqlService } from "./services/ksql-service.ts";
import { SchemaRegistryService } from "./services/schema-registry-service.ts";
import { initTelemetry, shutdownTelemetry } from "./telemetry/telemetry.ts";
import { registerAllTools, type ToolRegistrationOptions } from "./tools/index.ts";
import { createTransport } from "./transport/factory.ts";

async function main(): Promise<void> {
  // 1. Load config
  const config = getConfig();

  // 2. Create logger
  const logger = createLogger({
    level: config.logging.level,
    name: config.telemetry.serviceName,
    isDev: config.kafka.provider === "local",
  });
  setLogger(logger);
  logger.info("Starting Kafka MCP Server", {
    provider: config.kafka.provider,
    clientId: config.kafka.clientId,
    transport: config.transport.mode,
  });

  // 3. Init telemetry
  let sdk: NodeSDK | null = null;
  if (config.telemetry.enabled) {
    sdk = initTelemetry(config.telemetry);
    logger.info("Telemetry initialized", { mode: config.telemetry.mode });
  }

  // 4. Create provider
  const provider = createProvider(config);
  logger.info(`Provider created: ${provider.name}`);

  // 5. Create client manager and service
  const clientManager = new KafkaClientManager(provider);
  const kafkaService = new KafkaService(clientManager);

  // 6. Create optional services
  const toolOptions: ToolRegistrationOptions = {};

  if (config.schemaRegistry.enabled) {
    toolOptions.schemaRegistryService = new SchemaRegistryService(config);
    logger.info("Schema Registry enabled", { url: config.schemaRegistry.url });
  }

  if (config.ksql.enabled) {
    toolOptions.ksqlService = new KsqlService(config);
    logger.info("ksqlDB enabled", { endpoint: config.ksql.endpoint });
  }

  // 7. Server factory -- creates a fully configured McpServer instance
  const serverFactory = (): McpServer => {
    const server = new McpServer({
      name: "kafka-mcp-server",
      version: "1.0.0",
    });
    registerAllTools(server, kafkaService, config, toolOptions);
    return server;
  };

  const toolCount = 15 + (config.schemaRegistry.enabled ? 8 : 0) + (config.ksql.enabled ? 7 : 0);
  logger.info(`Tool registration ready (${toolCount} tools per server instance)`);

  // 8. Start transport(s)
  const transport = await createTransport(config, serverFactory);

  // 9. Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);

    try {
      await transport.closeAll();
    } catch (error) {
      logger.error("Error closing transports", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await clientManager.close();
      logger.info("Kafka clients closed");
    } catch (error) {
      logger.error("Error closing Kafka clients", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await shutdownTelemetry(sdk);
    } catch (error) {
      logger.error("Error shutting down telemetry", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.flush();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  const logger = getLogger();
  logger.error("Fatal error starting server", {
    error: error instanceof Error ? error.message : String(error),
  });
  logger.flush();
  process.exit(1);
});
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 4: Manual smoke test -- stdio mode (default)**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | timeout 5 bun run src/index.ts 2>/dev/null || true`
Expected: JSON-RPC response with server capabilities (proves stdio still works)

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "SIO-532: Refactor entry point to use transport factory"
```

---

## Task 7: Update CLAUDE.md Architecture (SIO-534 partial)

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update architecture section in CLAUDE.md**

Add the `transport/` directory to the architecture diagram and add transport config documentation.

In the Architecture section, add after `tools/` entries:

```
  transport/    Transport abstraction layer
    stdio.ts    StdioServerTransport lifecycle
    http.ts     Bun.serve() + WebStandardStreamableHTTPServerTransport
    middleware.ts HOF security wrappers (withOriginValidation, withApiKeyAuth)
    factory.ts  Transport selection based on MCP_TRANSPORT
```

Add a new Configuration section or extend the existing one:

```
## Transport

Env var `MCP_TRANSPORT` selects transport mode: `stdio` (default), `http`, or `both`.

HTTP mode uses `Bun.serve()` with `WebStandardStreamableHTTPServerTransport` from the MCP SDK. Session mode (`MCP_SESSION_MODE`) can be `stateless` (per-request server) or `stateful` (session-reused server).

Security: `MCP_API_KEY` enables Bearer token auth. `MCP_ALLOWED_ORIGINS` restricts cross-origin requests.

| Variable | Default | Description |
| --- | --- | --- |
| `MCP_TRANSPORT` | `stdio` | Transport mode: stdio, http, both |
| `MCP_PORT` | `3000` | HTTP server port |
| `MCP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_PATH` | `/mcp` | MCP endpoint path |
| `MCP_SESSION_MODE` | `stateless` | Session mode: stateless, stateful |
| `MCP_API_KEY` | (none) | Bearer token for HTTP auth |
| `MCP_ALLOWED_ORIGINS` | (none) | Comma-separated allowed origins |
| `MCP_IDLE_TIMEOUT` | `120` | Bun.serve() idle timeout (seconds) |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "SIO-534: Update CLAUDE.md with transport layer architecture"
```

---

## Task 8: Run All Tests and Final Verification (SIO-533 partial)

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass (config, middleware, factory, http)

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run linter**

Run: `biome check .`
Expected: No errors (warnings acceptable)

- [ ] **Step 4: Verify default stdio behavior unchanged**

Run: `bun run dev` (Ctrl+C after startup)
Expected: Same startup logs as before, "MCP server connected via stdio"

- [ ] **Step 5: Final commit if any lint fixes needed**

```bash
git add -A
git commit -m "SIO-526: Final cleanup for Epic 2 transport layer"
```
