# Bun Structured Logging Guide

Standalone guide to production-ready structured logging for Bun HTTP server applications using Pino with ECS formatting and OpenTelemetry trace context. Drop this file into your project and start logging.

## Quick Start

### Install Dependencies

```bash
bun add pino@^10.3.1 @elastic/ecs-pino-format@^1.5.0
bun add @opentelemetry/api@^1.9.0 @opentelemetry/instrumentation-pino@^0.58.0
```

### Minimal Usage

```typescript
import pino from "pino";
import { ecsFormat } from "@elastic/ecs-pino-format";

const logger = pino({
  level: "info",
  ...ecsFormat({ serviceName: "my-service" }),
});

logger.info("Server started");
logger.info({ port: 3000 }, "Listening on port");
logger.error({ err: new Error("Connection failed") }, "Database error");
```

That is enough to get structured ECS-compliant JSON logs on stdout. The rest of this guide covers the full production architecture: interfaces, DI, dual-mode output, trace correlation, OTLP export, and testing.

---

## Architecture

The logging system follows a 3-layer Clean Architecture pattern that separates application code from implementation details.

```
Layer 3: Application Code
  src/utils/logger.ts              log(), warn(), error(), logError()
                                   Convenience functions for application use

Layer 2: DI Container
  src/logging/container.ts         Backend selection (singleton)
  src/logging/ports/logger.port.ts ILogger interface (port)

Layer 1: Backend Adapter
  src/logging/adapters/pino.adapter.ts   Pino with ECS formatting (adapter)
```

**Data flow**: Application code calls `log("message", context)` -> DI container resolves the current backend -> Pino adapter formats as ECS JSON -> stdout (+ optional OTLP export).

**Why this matters**: You can swap Pino for any other logging library by implementing a new adapter. Application code never imports Pino directly.

---

## ILogger Interface

The core interface all backends implement. This is the **port** in ports-and-adapters architecture.

```typescript
// src/logging/ports/logger.port.ts

type LogContext = Record<string, unknown>;

type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

interface ServiceInfo {
  name: string;
  version: string;
  environment: string;
}

interface LoggerConfig {
  level: LogLevel;
  service: ServiceInfo;
  mode: "console" | "otlp" | "both";
}

interface ILogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): ILogger;
  flush(): Promise<void>;
  reinitialize(): void;
}
```

| Method | Purpose |
|--------|---------|
| `debug()` | Verbose development information |
| `info()` | Normal operational events |
| `warn()` | Potential issues worth attention |
| `error()` | Errors and failures |
| `child()` | Create a child logger with bound context (e.g., per-request) |
| `flush()` | Drain pending log entries during graceful shutdown |
| `reinitialize()` | Recreate the logger instance after OTEL SDK initialization |

The `reinitialize()` method exists because the `OTelPinoStream` (for OTEL log export) can only be attached when a `LoggerProvider` is registered. Loggers created before `initTelemetry()` won't have the stream. Calling `reinitialize()` after telemetry startup recreates the Pino instance with the OTEL log stream attached.

---

## Configuration

### Environment Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `LOG_LEVEL` | `silent`, `error`, `warn`, `info`, `debug` | `info` | Minimum log level |
| `LOGGING_BACKEND` | `pino` | `pino` | Logging backend selection |
| `TELEMETRY_MODE` | `console`, `otlp`, `both` | `both` | Where logs are sent |
| `NODE_ENV` | Any string | (unset) | Controls output format (raw JSON vs human-readable) |

### Log Level Filtering

Log levels follow a numeric priority. Setting a level enables that level and all levels with lower priority (higher severity).

| Level | Priority | Severity |
|-------|----------|----------|
| `silent` | 0 | No output |
| `error` | 1 | Highest |
| `warn` | 2 | High |
| `info` | 3 | Normal |
| `debug` | 4 | Verbose |

**Visibility matrix** -- check marks indicate which levels produce output at each setting:

| LOG_LEVEL setting | `error` | `warn` | `info` | `debug` |
|-------------------|---------|--------|--------|---------|
| `silent` | -- | -- | -- | -- |
| `error` | yes | -- | -- | -- |
| `warn` | yes | yes | -- | -- |
| `info` | yes | yes | yes | -- |
| `debug` | yes | yes | yes | yes |

### Recommended Levels by Environment

| Environment | NODE_ENV | LOG_LEVEL | TELEMETRY_MODE | Output |
|-------------|----------|-----------|----------------|--------|
| Local dev | `local` | `debug` | `console` | Human-readable formatted |
| Testing | `test` | `silent` | `console` | Suppressed |
| Staging | `staging` | `info` | `both` | Raw ECS NDJSON |
| Production | `production` | `warn` | `otlp` or `both` | Raw ECS NDJSON |

---

## Pino Backend

The Pino adapter is the recommended backend for Bun applications. It provides:

- ECS-compliant structured output via `@elastic/ecs-pino-format`
- Dual-mode output (raw NDJSON for production, human-readable for development)
- OpenTelemetry and LangSmith trace context injection via Pino mixin
- OTLP log export via manual `OTelPinoStream` attachment (Bun-compatible, bypasses PinoInstrumentation)
- Synchronous stdout writes (no worker threads, which have issues in Bun)

### Dual-Mode Output

The output format is determined by `NODE_ENV` at the time each log call is made.

| Mode | NODE_ENV | Output Format | Use Case |
|------|----------|---------------|----------|
| Production | `production` or `staging` | Raw ECS NDJSON | Log aggregators (Elasticsearch, Datadog, Splunk) |
| Development | Everything else | Human-readable formatted | Developer console |

**Production output** (raw ECS NDJSON -- one JSON object per line):

```json
{"@timestamp":"2026-01-20T12:00:00.000Z","log.level":"info","message":"Request processed","ecs.version":"8.10.0","service.name":"my-service","service.version":"1.0.0","service.environment":"production","event.dataset":"my-service","process.pid":1234,"host.hostname":"pod-1","trace.id":"550e8400e29b41d4a716446655440000","span.id":"550e8400e29b","transaction.id":"550e8400e29b41d4a716446655440000","langsmith.run_id":"019ce563-2abb-7169-be98-3603ec034f72","langsmith.trace_id":"019ce563-2abb-7169-be98-3603ec034f72","langsmith.project":"es-agent","statusCode":200,"duration":12}
```

**Development output** (human-readable, same data -- langsmith fields visible in context):

```
12:00:00 PM info: Request processed {"statusCode":200,"duration":12,"trace.id":"550e8400e29b41d4a716446655440000","langsmith.run_id":"019ce563-2abb-7169-be98-3603ec034f72","langsmith.project":"es-agent"}
```

---

## ecsFormat() Configuration

The `@elastic/ecs-pino-format` package transforms Pino output into Elastic Common Schema format. It provides formatters and hooks that Pino merges into its options.

```typescript
import { ecsFormat } from "@elastic/ecs-pino-format";

const ecsOptions = ecsFormat({
  // Disable Elastic APM agent integration -- use OpenTelemetry instead
  apmIntegration: false,

  // Service metadata injected into every log record
  serviceName: "my-service",
  serviceVersion: "1.0.0",
  serviceEnvironment: "production",

  // Convert Error objects to ECS error fields (error.type, error.message, error.stack_trace)
  convertErr: true,

  // Convert req/res objects to ECS HTTP fields (http.request.method, url.path, etc.)
  convertReqRes: true,
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apmIntegration` | `boolean` | `true` | Set `false` when using OTEL instead of Elastic APM |
| `serviceName` | `string` | -- | Populates `service.name` in every record |
| `serviceVersion` | `string` | -- | Populates `service.version` |
| `serviceEnvironment` | `string` | -- | Populates `service.environment` |
| `convertErr` | `boolean` | `true` | Convert `err` property to ECS `error.*` fields |
| `convertReqRes` | `boolean` | `false` | Convert `req`/`res` to ECS HTTP fields |

The returned object contains `formatters`, `messageKey`, and `timestamp` properties that you spread into `pino()` options.

---

## ECS Field Inventory

Every production NDJSON log line contains these fields.

### Standard Fields

| ECS Field | Source | Example Value |
|-----------|--------|---------------|
| `@timestamp` | ecsFormat timestamp function | `"2026-01-20T12:00:00.000Z"` |
| `log.level` | ecsFormat level formatter | `"info"` |
| `message` | First argument to log call | `"Request processed"` |
| `ecs.version` | `@elastic/ecs-helpers` | `"8.10.0"` |
| `process.pid` | Pino base binding | `1234` |
| `host.hostname` | Pino base binding | `"pod-1"` |
| `service.name` | ecsFormat `serviceName` config | `"my-service"` |
| `service.version` | ecsFormat `serviceVersion` config | `"1.0.0"` |
| `service.environment` | ecsFormat `serviceEnvironment` config | `"production"` |
| `event.dataset` | Defaults to `serviceName` value | `"my-service"` |

### Trace Context Fields (from mixin)

| ECS Field | Source | Example Value |
|-----------|--------|---------------|
| `trace.id` | OpenTelemetry active span | `"550e8400e29b41d4a716446655440000"` |
| `span.id` | OpenTelemetry active span | `"550e8400e29b"` |
| `transaction.id` | Same as `trace.id` | `"550e8400e29b41d4a716446655440000"` |

### LangSmith Context Fields (from mixin)

These fields appear when logging inside a LangSmith `traceable()` context (e.g., MCP tool executions). They enable direct correlation between log output and LangSmith traces. Unlike ECS metadata fields, these are **not** stripped from dev console output -- they are visible in both dev and production modes.

| Field | Source | Example Value |
|-------|--------|---------------|
| `langsmith.run_id` | `getCurrentRunTree()` run ID | `"019ce563-2abb-7169-be98-3603ec034f72"` |
| `langsmith.trace_id` | `getCurrentRunTree()` trace ID | `"019ce563-2abb-7169-be98-3603ec034f72"` |
| `langsmith.project` | `LANGSMITH_PROJECT` / `LANGCHAIN_PROJECT` env var | `"es-agent"` |

These fields can also be bound explicitly via child loggers (e.g., in the web stream endpoint after capturing `runId` from stream events).

### Error Fields (when logging errors)

| ECS Field | Source | Example Value |
|-----------|--------|---------------|
| `error.type` | `err.name` via `convertErr` | `"TypeError"` |
| `error.message` | `err.message` via `convertErr` | `"Cannot read property 'id' of undefined"` |
| `error.stack_trace` | `err.stack` via `convertErr` | `"TypeError: Cannot read...\n    at ..."` |

---

## Development Console Formatter

In non-production environments, raw NDJSON is difficult to scan visually. The development formatter parses each JSON line and outputs a compact, colorized format.

### Output Format

```
h:MM:ss TT level: message {context}
```

Example:

```
4:25:58 PM info: Server started {"port":3000}
4:25:59 PM debug: Processing request {"method":"GET","path":"/health"}
4:26:01 PM error: Database connection failed {"error":{"name":"ConnectionError"}}
```

### ANSI Color Codes by Level

| Level | ANSI Code | Color |
|-------|-----------|-------|
| `trace` | `\x1b[90m` | Gray |
| `debug` | `\x1b[36m` | Cyan |
| `info` | `\x1b[32m` | Green |
| `warn` | `\x1b[33m` | Yellow |
| `error` | `\x1b[31m` | Red |
| `fatal` | `\x1b[35m` | Magenta |

Reset code: `\x1b[0m`

### ECS Metadata Fields Stripped from Console

These fields are present in every log line but carry no operational value in a developer console. They are excluded from the `{context}` portion of formatted output:

| Field | Reason for exclusion |
|-------|---------------------|
| `@timestamp` | Already shown as the time prefix |
| `ecs.version` | Static metadata |
| `log.level` | Already shown as the level label |
| `log.logger` | Static metadata |
| `process.pid` | Rarely useful in development |
| `host.hostname` | Rarely useful in development |
| `service.name` | Static metadata |
| `service.version` | Static metadata |
| `service.environment` | Static metadata |
| `event.dataset` | Static metadata |

### formatLogLine Implementation

```typescript
const ECS_METADATA_FIELDS = new Set([
  "@timestamp",
  "ecs.version",
  "log.level",
  "log.logger",
  "process.pid",
  "host.hostname",
  "service.name",
  "service.version",
  "service.environment",
  "event.dataset",
]);

function formatLogLine(obj: Record<string, unknown>): string {
  // ECS format uses "log.level" string, standard Pino uses numeric "level"
  const ecsLevel = obj["log.level"] as string | undefined;
  const pinoLevel = obj.level as number | undefined;

  const levelName =
    ecsLevel?.toLowerCase() ||
    (pinoLevel === 10
      ? "trace"
      : pinoLevel === 20
        ? "debug"
        : pinoLevel === 30
          ? "info"
          : pinoLevel === 40
            ? "warn"
            : pinoLevel === 50
              ? "error"
              : pinoLevel === 60
                ? "fatal"
                : "info");

  // ECS uses "message", standard Pino uses "msg"
  const msg = (obj.message as string) || (obj.msg as string) || "";

  // ECS uses "@timestamp" ISO string, standard Pino uses "time" epoch
  const timestamp = obj["@timestamp"] as string | undefined;
  const pinoTime = obj.time as number | undefined;
  const date = timestamp ? new Date(timestamp) : new Date(pinoTime || Date.now());

  // Color codes
  const colors: Record<string, string> = {
    trace: "\x1b[90m",
    debug: "\x1b[36m",
    info: "\x1b[32m",
    warn: "\x1b[33m",
    error: "\x1b[31m",
    fatal: "\x1b[35m",
  };
  const reset = "\x1b[0m";

  // Format time as "h:MM:ss TT"
  const hours = date.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  const timeStr = `${hour12}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")} ${ampm}`;

  // Extract context -- exclude ECS metadata and standard Pino fields
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (["level", "time", "msg", "message", "pid", "hostname"].includes(key)) continue;
    if (ECS_METADATA_FIELDS.has(key)) continue;
    context[key] = value;
  }

  const contextStr = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : "";
  return `${timeStr} ${colors[levelName]}${levelName}${reset}: ${msg}${contextStr}\n`;
}
```

### formattedDestination Pattern

Instead of using `pino.transport()` (which spawns worker threads and has issues in Bun), use a synchronous write destination:

```typescript
const formattedDestination = {
  write: (data: string) => {
    try {
      const obj = JSON.parse(data);
      const formatted = formatLogLine(obj);
      process.stdout.write(formatted);
    } catch {
      // Fallback for non-JSON data
      process.stdout.write(data);
    }
  },
};

const logger = pino(pinoOptions, formattedDestination);
```

---

## Trace Context Correlation

Every log line should include tracing identifiers so that logs can be correlated with distributed traces. The mixin injects both OpenTelemetry trace context and LangSmith run context when available.

### Pino Mixin

A Pino mixin runs on every log call and merges its return value into the log record. It extracts OTEL span context and LangSmith run context independently -- either, both, or neither may be present.

```typescript
import { isSpanContextValid, trace } from "@opentelemetry/api";
import { getLangSmithContext } from "../langsmith/context.ts";

const traceMixin = (): Record<string, string> => {
  const otel: Record<string, string> = {};

  const span = trace.getActiveSpan();
  if (span) {
    const ctx = span.spanContext();
    if (isSpanContextValid(ctx)) {
      otel["trace.id"] = ctx.traceId;
      otel["span.id"] = ctx.spanId;
      otel["transaction.id"] = ctx.traceId;
    }
  }

  const langsmith = getLangSmithContext();

  return { ...otel, ...langsmith };
};
```

The `getLangSmithContext()` utility uses `getCurrentRunTree(true)` from `langsmith/singletons/traceable` to extract `langsmith.run_id`, `langsmith.trace_id`, and `langsmith.project`. It gracefully returns `{}` when the `langsmith` package is not installed or when no traceable context exists.

### Why Custom Mixin Instead of PinoInstrumentation's Built-in

`PinoInstrumentation` (from `@opentelemetry/instrumentation-pino`) is **not used** in this project. It was removed because its `require()` hooks do not work in Bun. Its two features are handled directly:

1. **Log correlation** -- handled by the custom mixin above (ECS dot-notation)
2. **OTLP log export** -- handled by manual `OTelPinoStream` attachment (see OTLP Log Export section below)

For reference, PinoInstrumentation's built-in correlation uses underscore notation (`trace_id`, `span_id`) which is incompatible with Elasticsearch/Kibana's ECS dot-notation expectations (`trace.id`, `span.id`). The custom mixin avoids this problem entirely.

---

## Complete Logger Assembly

This is the full copy-pasteable implementation. Create this file and adjust the config values to match your service.

```typescript
// src/logging/create-logger.ts

import { ecsFormat } from "@elastic/ecs-pino-format";
import { isSpanContextValid, trace } from "@opentelemetry/api";
import pino from "pino";

// -- Types ------------------------------------------------------------------

type LogContext = Record<string, unknown>;

interface LoggerConfig {
  level: string;
  service: { name: string; version: string; environment: string };
}

// -- Helpers ----------------------------------------------------------------

function isProductionOutput(): boolean {
  const env = process.env.NODE_ENV;
  return env === "production" || env === "staging";
}

const ECS_METADATA_FIELDS = new Set([
  "@timestamp",
  "ecs.version",
  "log.level",
  "log.logger",
  "process.pid",
  "host.hostname",
  "service.name",
  "service.version",
  "service.environment",
  "event.dataset",
]);

function formatLogLine(obj: Record<string, unknown>): string {
  const ecsLevel = obj["log.level"] as string | undefined;
  const pinoLevel = obj.level as number | undefined;

  const levelName =
    ecsLevel?.toLowerCase() ||
    (pinoLevel === 10
      ? "trace"
      : pinoLevel === 20
        ? "debug"
        : pinoLevel === 30
          ? "info"
          : pinoLevel === 40
            ? "warn"
            : pinoLevel === 50
              ? "error"
              : pinoLevel === 60
                ? "fatal"
                : "info");

  const msg = (obj.message as string) || (obj.msg as string) || "";

  const timestamp = obj["@timestamp"] as string | undefined;
  const pinoTime = obj.time as number | undefined;
  const date = timestamp ? new Date(timestamp) : new Date(pinoTime || Date.now());

  const colors: Record<string, string> = {
    trace: "\x1b[90m",
    debug: "\x1b[36m",
    info: "\x1b[32m",
    warn: "\x1b[33m",
    error: "\x1b[31m",
    fatal: "\x1b[35m",
  };
  const reset = "\x1b[0m";

  const hours = date.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  const timeStr = `${hour12}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")} ${ampm}`;

  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (["level", "time", "msg", "message", "pid", "hostname"].includes(key)) continue;
    if (ECS_METADATA_FIELDS.has(key)) continue;
    context[key] = value;
  }

  const contextStr = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : "";
  return `${timeStr} ${colors[levelName]}${levelName}${reset}: ${msg}${contextStr}\n`;
}

// -- Trace Context Mixin ----------------------------------------------------

// getLangSmithContext() is imported from a utility that uses require() with
// try/catch for the langsmith package -- graceful degradation if not installed.
import { getLangSmithContext } from "../langsmith/context.ts";

const traceMixin = (): Record<string, string> => {
  const otel: Record<string, string> = {};

  const span = trace.getActiveSpan();
  if (span) {
    const ctx = span.spanContext();
    if (isSpanContextValid(ctx)) {
      otel["trace.id"] = ctx.traceId;
      otel["span.id"] = ctx.spanId;
      otel["transaction.id"] = ctx.traceId;
    }
  }

  const langsmith = getLangSmithContext();

  return { ...otel, ...langsmith };
};

// -- Logger Factory ---------------------------------------------------------

export function createLogger(config: LoggerConfig): pino.Logger {
  const ecsOptions = ecsFormat({
    apmIntegration: false,
    serviceName: config.service.name,
    serviceVersion: config.service.version,
    serviceEnvironment: config.service.environment,
    convertErr: true,
    convertReqRes: true,
  });

  const pinoOptions: pino.LoggerOptions = {
    level: config.level,
    ...ecsOptions,
    mixin: traceMixin,
  };

  if (isProductionOutput()) {
    // Production: raw ECS NDJSON to stdout.
    // Use process.stdout.write (not pino.destination({ dest: 1 }))
    // so that test frameworks and log capture tools can intercept output.
    const rawDestination = {
      write: (data: string) => {
        process.stdout.write(data);
      },
    };
    return pino(pinoOptions, rawDestination);
  }

  // Development: human-readable formatted output via synchronous destination.
  // Avoids pino.transport() worker threads which have issues with Bun.
  const formattedDestination = {
    write: (data: string) => {
      try {
        const obj = JSON.parse(data);
        const formatted = formatLogLine(obj);
        process.stdout.write(formatted);
      } catch {
        process.stdout.write(data);
      }
    },
  };

  return pino(pinoOptions, formattedDestination);
}

// -- Default Instance -------------------------------------------------------

const defaultLogger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  service: {
    name: process.env.SERVICE_NAME || "my-service",
    version: process.env.SERVICE_VERSION || "1.0.0",
    environment: process.env.NODE_ENV || "development",
  },
});

export default defaultLogger;
```

### Usage

```typescript
import logger from "./logging/create-logger";

// Direct Pino usage
logger.info("Server started");
logger.info({ port: 3000 }, "Listening");
logger.error({ err: new Error("Timeout") }, "Request failed");

// Child logger with bound context
const reqLogger = logger.child({ requestId: "abc-123" });
reqLogger.info("Processing request");  // requestId included automatically
```

---

## Error Logging

Errors should be passed as the `err` property in the context object. When `convertErr: true` is set in ecsFormat, Pino automatically converts the Error into ECS fields.

### Input

```typescript
logger.error({ err: new Error("Connection refused") }, "Database unavailable");
```

### Output (production NDJSON)

```json
{
  "@timestamp": "2026-01-20T12:00:00.000Z",
  "log.level": "error",
  "message": "Database unavailable",
  "error.type": "Error",
  "error.message": "Connection refused",
  "error.stack_trace": "Error: Connection refused\n    at connect (/app/src/db.ts:42:11)\n    at ...",
  "service.name": "my-service",
  "trace.id": "550e8400e29b41d4a716446655440000",
  "span.id": "550e8400e29b"
}
```

### Convenience logError Function

If you prefer a wrapper that accepts an Error as a separate argument:

```typescript
export function logError(
  message: string,
  err: Error,
  context: Record<string, unknown> = {},
): void {
  logger.error(
    {
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
      ...context,
    },
    message,
  );
}
```

---

## OTLP Log Export

Every Pino log record is exported to the OTEL collector alongside traces and metrics. This is done by manually attaching an `OTelPinoStream` to the Pino logger via `pino.multistream()`.

### Why Not PinoInstrumentation?

The standard approach is `PinoInstrumentation` from `@opentelemetry/instrumentation-pino`, which monkey-patches `pino()` via Node.js `require()` hooks. **Bun does not support these hooks**, so the patch never applies and logs never reach the OTEL pipeline. This project uses a manual attachment approach that works in both Bun and Node.js.

### How It Works

After each Pino logger instance is created, `attachOTelStream()` checks if an SDK `LoggerProvider` is registered. If so, it creates an `OTelPinoStream` (from the instrumentation-pino package's internals) and replaces the logger's stream with a `pino.multistream` that sends to both the original destination and the OTEL stream.

```
logger.info("message", { context })
    |
    v
Pino serializes to JSON
    |
    v
pino.multistream dispatches to both streams:
    |
    +-> Original destination (stdout/stderr)
    |     Dev: formatLogLine() -> human-readable
    |     Prod: raw ECS NDJSON
    |
    +-> OTelPinoStream
          |
          v
        Parse JSON -> convert to OTEL LogRecord
          |
          v
        logs.getLogger().emit(record)
          |
          v
        BatchLogRecordProcessor
          |
          v
        OTLPLogExporter -> OTLP Collector -> Elasticsearch
```

Every log call produces output in **two places**: the configured destination (stdout/stderr) and the OTLP pipeline.

### attachOTelStream Implementation

Source: `src/adapters/pino-otel-stream.ts`

```typescript
import { createRequire } from "node:module";
import { logs } from "@opentelemetry/api-logs";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
import pino from "pino";

// Resolve from this package's node_modules (not the caller's)
const localRequire = createRequire(import.meta.url);
const { OTelPinoStream, getTimeConverter } = localRequire(
  "@opentelemetry/instrumentation-pino/build/src/log-sending-utils"
);

export function attachOTelStream(logger: pino.Logger): boolean {
  // Only attach when an SDK LoggerProvider is registered (not ProxyLoggerProvider)
  const provider = logs.getLoggerProvider();
  if (!(provider instanceof LoggerProvider)) return false;

  // Read current stream, skip if already wrapped
  const origStream = logger[pino.symbols.streamSym];
  if (origStream && "streams" in origStream) return false;

  // Create OTelPinoStream with logger's message key and time converter
  const otelStream = new OTelPinoStream({
    messageKey: logger[pino.symbols.messageKeySym],
    levels: logger.levels,
    otelTimestampFromTime: getTimeConverter(logger, pino),
  });
  otelStream[Symbol.for("pino.metadata")] = true;

  // Replace stream with multistream
  logger[pino.symbols.streamSym] = pino.multistream([
    { level: 0, stream: origStream },
    { level: 0, stream: otelStream },
  ], { levels: logger.levels.values });

  return true;
}
```

Key details:
- Uses `createRequire(import.meta.url)` to resolve from the observability package's `node_modules`, not the importing package's
- Checks `instanceof LoggerProvider` (the API returns `ProxyLoggerProvider` before `setGlobalLoggerProvider()` is called)
- Prevents double-wrapping by checking for existing `.streams` property
- Graceful degradation: returns `false` if any step fails

### Initialization Order

The `LoggerProvider` must be registered before `attachOTelStream` can succeed. The standard initialization pattern:

```typescript
// 1. Configure logger (creates Pino instance -- no OTEL stream yet)
loggerContainer.configure({ level: "info", service: { ... } });

// 2. Initialize telemetry (registers LoggerProvider)
const telemetry = initTelemetry({ serviceVersion: "0.1.0" });

// 3. Reinitialize logger (recreates Pino instance with OTEL stream attached)
telemetry.reinitializeLogger();
```

The `reinitialize()` call is critical. It recreates the Pino instance, and `createPinoInstance()` calls `attachOTelStream()` which now finds the registered `LoggerProvider` and attaches the stream.

### Internal Dependency

`OTelPinoStream` and `getTimeConverter` are imported from `@opentelemetry/instrumentation-pino/build/src/log-sending-utils` -- an internal, non-exported path. This path was verified against v0.59.0. If the path changes in a future version, `attachOTelStream` gracefully returns `false` (logs continue to stdout/stderr only). A test guards against import path resolution failures.

---

## DI Container

The DI container manages the logger singleton and enables test injection.

```typescript
// src/logging/container.ts

import type { ILogger } from "./ports/logger.port";
import { createLogger } from "./create-logger";

class LoggerContainer {
  private static instance: LoggerContainer | null = null;
  private currentLogger: ILogger | null = null;

  private constructor() {}

  static getInstance(): LoggerContainer {
    if (!LoggerContainer.instance) {
      LoggerContainer.instance = new LoggerContainer();
    }
    return LoggerContainer.instance;
  }

  getLogger(): ILogger {
    if (!this.currentLogger) {
      this.currentLogger = this.createDefaultLogger();
    }
    return this.currentLogger;
  }

  setLogger(logger: ILogger): void {
    this.currentLogger = logger;
  }

  reset(): void {
    this.currentLogger = null;
  }

  private createDefaultLogger(): ILogger {
    // Wrap the Pino logger in an ILogger-compatible adapter
    // (see the PinoAdapter class in the Architecture section)
    const pinoInstance = createLogger({
      level: process.env.LOG_LEVEL || "info",
      service: {
        name: process.env.SERVICE_NAME || "my-service",
        version: process.env.SERVICE_VERSION || "1.0.0",
        environment: process.env.NODE_ENV || "development",
      },
    });

    return {
      debug: (msg, ctx) => pinoInstance.debug(ctx || {}, msg),
      info: (msg, ctx) => pinoInstance.info(ctx || {}, msg),
      warn: (msg, ctx) => pinoInstance.warn(ctx || {}, msg),
      error: (msg, ctx) => pinoInstance.error(ctx || {}, msg),
      child: (bindings) => {
        const child = pinoInstance.child(bindings);
        return {
          debug: (msg, ctx) => child.debug(ctx || {}, msg),
          info: (msg, ctx) => child.info(ctx || {}, msg),
          warn: (msg, ctx) => child.warn(ctx || {}, msg),
          error: (msg, ctx) => child.error(ctx || {}, msg),
          child: (b) => pinoInstance.child({ ...bindings, ...b }) as unknown as ILogger,
          flush: async () => { child.flush(); },
          reinitialize: () => {},
        };
      },
      flush: async () => { pinoInstance.flush(); },
      reinitialize: () => {},
    };
  }
}

export const loggerContainer = LoggerContainer.getInstance();

export function getLogger(): ILogger {
  return loggerContainer.getLogger();
}

export function getChildLogger(bindings: Record<string, unknown>): ILogger {
  return loggerContainer.getLogger().child(bindings);
}
```

### Application-Level Convenience Functions

Wrap the container in simple functions for ergonomic use throughout your application:

```typescript
// src/utils/logger.ts

import { getLogger } from "../logging/container";

export function log(message: string, context: Record<string, unknown> = {}): void {
  getLogger().info(message, context);
}

export function warn(message: string, context: Record<string, unknown> = {}): void {
  getLogger().warn(message, context);
}

export function error(message: string, context: Record<string, unknown> = {}): void {
  getLogger().error(message, context);
}

export function logError(
  message: string,
  err: Error,
  context: Record<string, unknown> = {},
): void {
  getLogger().error(message, {
    error: { name: err.name, message: err.message, stack: err.stack },
    ...context,
  });
}

export const logger = { log, warn, error, logError };
```

---

## Testing

### Suppressing Logs in Tests

Set `LOG_LEVEL=silent` to suppress all log output during test runs. This keeps test output clean while still exercising the logging code paths.

```bash
LOG_LEVEL=silent bun test
```

Or in your test preload file:

```typescript
// test/preload.ts
process.env.LOG_LEVEL = "silent";
```

### Injecting a Mock Logger

Use the DI container to inject a mock logger for tests that need to assert on log calls.

```typescript
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { loggerContainer } from "../src/logging/container";
import type { ILogger } from "../src/logging/ports/logger.port";

describe("MyService", () => {
  let mockLogger: ILogger;

  beforeEach(() => {
    mockLogger = {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      child: mock(() => mockLogger),
      flush: mock(async () => {}),
      reinitialize: mock(() => {}),
    };
    loggerContainer.setLogger(mockLogger as any);
  });

  afterEach(() => {
    loggerContainer.reset();
  });

  it("should log a warning when threshold exceeded", () => {
    // ... call the code under test ...

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Threshold exceeded",
      expect.objectContaining({ value: 100 }),
    );
  });
});
```

### Testing Log Output Format

To test that production output is valid ECS JSON:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("ECS output format", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("should produce valid ECS NDJSON", () => {
    // Capture stdout
    const lines: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = (data: string) => {
      lines.push(data);
      return true;
    };

    // Create a fresh logger in production mode
    const { createLogger } = require("../src/logging/create-logger");
    const logger = createLogger({
      level: "info",
      service: { name: "test-service", version: "1.0.0", environment: "production" },
    });

    logger.info("Test message");

    // Restore stdout
    process.stdout.write = originalWrite;

    const record = JSON.parse(lines[0]);
    expect(record["@timestamp"]).toBeDefined();
    expect(record["log.level"]).toBe("info");
    expect(record.message).toBe("Test message");
    expect(record["service.name"]).toBe("test-service");
    expect(record["ecs.version"]).toBeDefined();
  });
});
```

---

## Troubleshooting

### Logs Not Appearing

- **Check `LOG_LEVEL`**: If set to `silent`, no logs are produced. If set to `warn`, `info` and `debug` messages are suppressed.
- **Check the level priority table**: Ensure the level you are logging at is equal to or more severe than the configured `LOG_LEVEL`.
- **Check Pino instance is initialized**: If using the DI container, ensure `getLogger()` is called after the container is set up.

### Missing Trace Context (trace.id, span.id)

- **Check OTEL span is active**: The mixin calls `trace.getActiveSpan()`. If there is no active span (e.g., logging outside of an instrumented handler), trace fields will be absent.
- **Check OTEL SDK is started**: If the SDK has not been started, `trace.getActiveSpan()` always returns `undefined`.
- **Check span context is valid**: Invalid span contexts (all-zero trace IDs) are filtered out by `isSpanContextValid()`.

### Missing LangSmith Context (langsmith.run_id, langsmith.project)

- **Check you are inside a `traceable()` context**: The mixin calls `getCurrentRunTree(true)`. LangSmith fields only appear when logging inside a LangSmith traceable wrapper (e.g., MCP tool executions).
- **Check `langsmith` package is installed**: The context utility uses `require("langsmith/singletons/traceable")` with try/catch. If the package is not installed, all functions return `{}`.
- **Check LangSmith tracing is enabled**: Ensure `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` are set.
- **Check `LANGSMITH_PROJECT` env var**: The `langsmith.project` field is only included when `LANGSMITH_PROJECT` or `LANGCHAIN_PROJECT` is set.
- **Web layer uses explicit bindings**: In the web stream endpoint, LangSmith fields are bound via `reqLogger.child()` after `runId` is captured from stream events, not via the mixin.

### OTLP Logs Not Exporting

- **Check `TELEMETRY_MODE`**: Must be `otlp` or `both`. In `console` mode, no `LoggerProvider` is registered and `attachOTelStream` is a no-op.
- **Check `LoggerProvider` is registered**: `attachOTelStream` checks `instanceof LoggerProvider` from `@opentelemetry/sdk-logs`. If only a `ProxyLoggerProvider` is present (before `initTelemetry()`), the stream is not attached.
- **Reinitialize after telemetry init**: If the logger was created before `initTelemetry()`, call `reinitialize()` to recreate the Pino instance with the OTEL stream. The standard pattern is `initTelemetry()` then `telemetry.reinitializeLogger()`.
- **Check internal import resolves**: `attachOTelStream` imports from `@opentelemetry/instrumentation-pino/build/src/log-sending-utils`. If the package is not installed in the observability package's `node_modules`, the import fails silently and no stream is attached.
- **Check collector connectivity**: Verify the OTLP endpoint is reachable with `curl -X POST http://localhost:4318/v1/logs -H "Content-Type: application/json" -d '{"resourceLogs":[]}'`. Should return `{"partialSuccess":{}}`.
- **Check multistream is attached**: In a diagnostic, inspect `logger[pino.symbols.streamSym]`. If it has a `.streams` property with 2 entries, the OTEL stream is attached.

### Console Output Is Raw JSON Instead of Formatted

- **Check `NODE_ENV`**: If `NODE_ENV` is `production` or `staging`, the logger outputs raw NDJSON. Set `NODE_ENV` to `local`, `development`, `test`, or leave it unset for formatted output.
- **Check `isProductionOutput()`**: This function is called at logger creation time. If `NODE_ENV` was changed after the logger was created, call `reinitialize()`.

### Duplicate Log Lines

- **`attachOTelStream` adds a second stream via `pino.multistream()`**: This is expected. One copy goes to your destination (stdout/stderr), the other goes to OTelPinoStream (OTLP). They should not both appear on stdout.
- **Double-wrapping guard**: `attachOTelStream` checks for an existing `.streams` property before wrapping. If you see more than 2 streams, something is calling `pino.multistream()` separately.

### Bun-Specific Issues

- **`pino.transport()` worker threads**: Pino's transport mechanism uses Node.js worker threads, which have compatibility issues in Bun. Use synchronous write destinations (as shown in this guide) instead.
- **`pino.destination({ dest: 1 })`**: This writes directly to file descriptor 1, bypassing `process.stdout.write`. Use the `{ write: (data) => process.stdout.write(data) }` pattern instead for compatibility with test capture and log interception.

---

## Best Practices

1. **Use the ILogger interface** -- never import Pino directly in application code. This enables backend swaps and test injection.
2. **Set LOG_LEVEL=silent in tests** -- keep test output clean while still exercising log code paths.
3. **Use child loggers for request scope** -- bind `requestId`, `userId`, or `correlationId` once at the start of a request handler.
4. **Log at the right level** -- `debug` for development diagnostics, `info` for operational events, `warn` for recoverable issues, `error` for failures.
5. **Pass errors as the `err` property** -- this triggers ECS error field conversion (`error.type`, `error.message`, `error.stack_trace`).
6. **Reinitialize after telemetry init** -- call `telemetry.reinitializeLogger()` after `initTelemetry()` so the Pino instance picks up the `OTelPinoStream` for OTLP export.
7. **Use synchronous destinations in Bun** -- avoid `pino.transport()` worker threads and `pino.destination()` file descriptors.
8. **Keep context objects flat** -- deeply nested context objects are harder to query in log aggregators.
9. **Do not log sensitive data** -- never include passwords, tokens, API keys, or PII in log context.
10. **Flush on shutdown** -- call `logger.flush()` during graceful shutdown to drain any buffered log entries.
