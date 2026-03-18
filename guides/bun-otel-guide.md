# OpenTelemetry for Bun Guide

Standalone guide to instrumenting Bun HTTP server applications with OpenTelemetry for distributed tracing, metrics, and log export. Drop this file into your project and start observing.

## Quick Start

```bash
bun add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/sdk-trace-base \
  @opentelemetry/sdk-metrics @opentelemetry/sdk-logs @opentelemetry/api-logs \
  @opentelemetry/resources @opentelemetry/semantic-conventions \
  @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http @opentelemetry/auto-instrumentations-node \
  @opentelemetry/host-metrics
```

```typescript
// src/telemetry.ts -- import this before anything else
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: new Resource({ [ATTR_SERVICE_NAME]: "my-service" }),
  traceExporter: new OTLPTraceExporter({ url: "http://localhost:4318/v1/traces" }),
});

sdk.start();
```

```typescript
// src/index.ts
import "./telemetry"; // must be first import
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("my-service");

Bun.serve({
  port: 3000,
  fetch(req) {
    return tracer.startActiveSpan("handle-request", (span) => {
      try {
        return new Response("OK");
      } finally {
        span.end();
      }
    });
  },
});
```

---

## Package Dependencies

```json
{
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/api-logs": "^0.212.0",
    "@opentelemetry/auto-instrumentations-node": "^0.212.0",
    "@opentelemetry/exporter-logs-otlp-http": "^0.212.0",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.212.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.212.0",
    "@opentelemetry/host-metrics": "^0.212.0",
    "@opentelemetry/resources": "^2.0.0",
    "@opentelemetry/sdk-logs": "^0.212.0",
    "@opentelemetry/sdk-metrics": "^2.0.0",
    "@opentelemetry/sdk-node": "^0.212.0",
    "@opentelemetry/sdk-trace-base": "^2.0.0",
    "@opentelemetry/semantic-conventions": "^1.28.0"
  }
}
```

All packages use OTLP/HTTP (JSON) transport. Bun has incomplete gRPC support, so HTTP/JSON is the reliable choice.

---

## Data Flow

```
 Application Code
       |
       v
 +-----+-----+-----+
 |     |     |     |
Tracer Meter Logger APIs (@opentelemetry/api)
 |     |     |     |
 v     v     v     v
BatchSpan  Periodic  BatchLog
Processor  Exporting RecordProcessor
           MetricReader
 |     |     |
 v     v     v
Circuit  Circuit  Circuit
Breaker  Breaker  Breaker
(traces) (metrics) (logs)
 |     |     |
 v     v     v
OTLP/HTTP  OTLP/HTTP  OTLP/HTTP
Exporter   Exporter   Exporter
 |     |     |
 +-----+-----+
       |
       v
 OTel Collector
       |
       v
 Observability Backend
 (Elastic, Jaeger, Grafana, etc.)
```

---

## Signal Flow Table

| Signal  | SDK Component    | Processor                        | Export Protocol | Batch Interval |
|---------|------------------|----------------------------------|-----------------|----------------|
| Traces  | TracerProvider   | BatchSpanProcessor               | OTLP/HTTP JSON  | 1000ms         |
| Metrics | MeterProvider    | PeriodicExportingMetricReader    | OTLP/HTTP JSON  | 30000ms        |
| Logs    | LoggerProvider   | BatchLogRecordProcessor          | OTLP/HTTP JSON  | SDK default    |

---

## SDK Initialization

Complete production-ready initialization. Copy this file into your project and adjust the service name.

```typescript
// src/telemetry.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { logs } from "@opentelemetry/api-logs";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { HostMetrics } from "@opentelemetry/host-metrics";

// 1. Create resource describing this service
const resource = new Resource({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "my-service",
  [ATTR_SERVICE_VERSION]: process.env.SERVICE_VERSION ?? "1.0.0",
  [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV ?? "development",
});

// 2. Configure OTLP exporters (HTTP/JSON -- Bun lacks full gRPC support)
const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

const traceExporter = new OTLPTraceExporter({
  url: `${otlpEndpoint}/v1/traces`,
});

const metricExporter = new OTLPMetricExporter({
  url: `${otlpEndpoint}/v1/metrics`,
});

const logExporter = new OTLPLogExporter({
  url: `${otlpEndpoint}/v1/logs`,
});

// 3. Create processors
const spanProcessor = new BatchSpanProcessor(traceExporter, {
  maxExportBatchSize: 10,
});

const metricReader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 30_000,
});

// 4. Register LoggerProvider globally (required for SDK 0.212.0+)
const loggerProvider = new LoggerProvider({ resource });
loggerProvider.addLogRecordProcessor(
  new BatchLogRecordProcessor(logExporter)
);
logs.setGlobalLoggerProvider(loggerProvider);

// 5. Start the SDK
//
// WARNING: getNodeAutoInstrumentations() has partial Bun support.
// Some Node.js auto-instrumentations (e.g., http, grpc) may not work
// or may silently fail under Bun. Test each instrumentation you rely on.
// gRPC transport is not reliable in Bun -- use OTLP/HTTP (JSON) only.
// See the Bun-Specific Issues table in Troubleshooting for details.
const sdk = new NodeSDK({
  resource,
  spanProcessors: [spanProcessor],
  metricReader,
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// 6. Start host metrics (CPU, memory, network)
const hostMetrics = new HostMetrics({ name: "my-service" });
hostMetrics.start();

// 7. Graceful shutdown
const shutdown = async () => {
  await sdk.shutdown();
  await loggerProvider.shutdown();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

**Important**: Import `src/telemetry.ts` as the very first import in your entry point so all auto-instrumentations patch modules before they are loaded.

```typescript
// src/index.ts
import "./telemetry"; // MUST be first
// ... rest of your application
```

---

## Creating Spans

### Synchronous Spans

```typescript
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("my-service");

function processOrder(orderId: string): Order {
  return tracer.startActiveSpan("order.process", (span) => {
    try {
      span.setAttribute("order.id", orderId);
      const order = validateOrder(orderId);
      span.setAttribute("order.item_count", order.items.length);
      return order;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### Async Spans

```typescript
async function fetchUser(userId: string): Promise<User> {
  return tracer.startActiveSpan("http.client.users.get", async (span) => {
    try {
      span.setAttribute("user.id", userId);
      const response = await fetch(`https://api.example.com/users/${userId}`);
      span.setAttribute("http.response.status_code", response.status);
      if (!response.ok) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
        throw new Error(`User fetch failed: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### SpanKind Reference

| SpanKind   | When to Use                         | Example                          |
|------------|-------------------------------------|----------------------------------|
| `INTERNAL` | Work inside the process (default)   | Business logic, data transforms  |
| `CLIENT`   | Making an outbound request          | HTTP fetch, database query       |
| `SERVER`   | Handling an inbound request         | HTTP handler, gRPC handler       |
| `PRODUCER` | Enqueuing a message                 | Publishing to a message queue    |
| `CONSUMER` | Processing a dequeued message       | Handling a queue message         |

```typescript
import { SpanKind } from "@opentelemetry/api";

tracer.startActiveSpan("http.client.database.query", { kind: SpanKind.CLIENT }, async (span) => {
  // outbound call
  span.end();
});
```

---

## Creating Metrics

```typescript
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("my-service");
```

### Counter

Monotonically increasing value. Use for things that only go up.

```typescript
const requestCounter = meter.createCounter("http.requests.total", {
  description: "Total number of HTTP requests received",
  unit: "requests",
});

// Record
requestCounter.add(1, {
  "http.request.method": "GET",
  "http.route": "/api/users",
  "http.response.status_code": 200,
});
```

### Histogram

Distribution of values. Use for latencies, sizes, or anything where percentiles matter.

```typescript
const requestDuration = meter.createHistogram("http.request.duration", {
  description: "HTTP request duration",
  unit: "ms",
});

// Record
const start = performance.now();
// ... handle request ...
requestDuration.record(performance.now() - start, {
  "http.request.method": "GET",
  "http.route": "/api/users",
});
```

### UpDownCounter

Value that goes up and down. Use for current levels.

```typescript
const activeConnections = meter.createUpDownCounter("http.connections.active", {
  description: "Number of active HTTP connections",
  unit: "connections",
});

// Increment when connection opens
activeConnections.add(1);

// Decrement when connection closes
activeConnections.add(-1);
```

### ObservableGauge

Snapshot value read periodically by the SDK. Use for system metrics.

```typescript
meter.createObservableGauge("process.memory.heap_used", {
  description: "Current heap memory usage",
  unit: "bytes",
}).addCallback((result) => {
  result.observe(process.memoryUsage().heapUsed);
});

meter.createObservableGauge("process.cpu.utilization", {
  description: "CPU utilization percentage",
  unit: "percent",
}).addCallback((result) => {
  const usage = process.cpuUsage();
  const totalMicros = usage.user + usage.system;
  result.observe(totalMicros / 1_000_000);
});
```

### Choosing the Right Instrument

| I want to measure...          | Instrument        | Example                    |
|-------------------------------|-------------------|----------------------------|
| How many times X happened     | Counter           | Requests, errors, retries  |
| How long X took               | Histogram         | Request latency            |
| Distribution of values        | Histogram         | Response body sizes        |
| Current level that goes up/down | UpDownCounter   | Active connections, queue depth |
| Snapshot read periodically    | ObservableGauge   | Memory usage, CPU percent  |

---

## Span Events

Span events are timestamped annotations within a span. They mark moments of interest without creating child spans.

### Simple Events

```typescript
tracer.startActiveSpan("order.process", (span) => {
  span.addEvent("validation.started");
  validate(order);
  span.addEvent("validation.completed");

  span.addEvent("payment.initiated");
  chargePayment(order);
  span.addEvent("payment.completed");

  span.end();
});
```

### Events with Attributes

```typescript
span.addEvent("cache.miss", {
  "cache.key": "user:12345",
  "cache.backend": "redis",
});

span.addEvent("retry.attempt", {
  "retry.count": 2,
  "retry.delay_ms": 500,
  "retry.reason": "connection_timeout",
});
```

### When to Use Span Events vs Logs

| Characteristic              | Span Event                       | Log Record                     |
|-----------------------------|----------------------------------|--------------------------------|
| Tied to a trace             | Yes (always within a span)       | Optional (can be correlated)   |
| Appears in trace waterfall  | Yes                              | No                             |
| High volume output          | Avoid (increases span size)      | Appropriate                    |
| Debug/diagnostic detail     | Use sparingly                    | Preferred                      |
| Marking a moment in time    | Preferred                        | Also works                     |
| Structured business data    | Possible (via attributes)        | Preferred                      |

---

## Error Handling in Spans

Always follow this pattern when recording errors on spans:

```typescript
tracer.startActiveSpan("operation.name", (span) => {
  try {
    // ... your code ...
  } catch (error) {
    // 1. Set span status to ERROR with a message
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });

    // 2. Record the exception (adds a span event with stack trace)
    if (error instanceof Error) {
      span.recordException(error);
    }

    // 3. Re-throw so callers can handle it
    throw error;
  } finally {
    // 4. Always end the span, even on error
    span.end();
  }
});
```

Key rules:
- **Always call `span.end()`** in a `finally` block. Unended spans leak memory and produce incomplete traces.
- **Always re-throw errors** after recording them. Telemetry should not swallow exceptions.
- **Use `recordException`** instead of manually adding error events. It follows the OTel semantic conventions for exception events.
- **Set status to ERROR only for unhandled/unexpected errors.** A 404 response is not an error -- it is expected behavior.

---

## Naming Conventions

All names use dot-separated lowercase. No camelCase, no hyphens.

### Span Names

| Pattern                                  | When                  | Example                      |
|------------------------------------------|-----------------------|------------------------------|
| `http.client.<service>.<operation>`      | Outbound HTTP call    | `http.client.database.query` |
| `crypto.<algorithm>.<operation>`         | Cryptographic work    | `crypto.hmac.sign`           |
| `cache.<backend>.<operation>`            | Cache operations      | `cache.redis.get`            |
| `<domain>.<operation>`                   | Business logic        | `order.validate`             |
| `<METHOD> <path>`                        | HTTP server handler   | `GET /api/users`             |

### Metric Names

| Pattern                                  | When                  | Example                      |
|------------------------------------------|-----------------------|------------------------------|
| `<noun>.<noun>.<unit_or_verb>`           | General measurement   | `http.requests.total`        |
| `<component>.<measurement>.{unit}`       | Duration/size         | `db.query.duration`          |

### Span Event Names

| Pattern                                  | When                  | Example                           |
|------------------------------------------|-----------------------|-----------------------------------|
| `<component>.<action>`                   | General action        | `cache.hit`                       |
| `<component>.<entity>.<action>`          | Entity operation      | `db.connection.established`       |

---

## How to Instrument a New Feature

### Step 1: Identify What to Measure

| You want to know...                      | Use           |
|------------------------------------------|---------------|
| How a request flows through services     | Span          |
| How many times something happened        | Metric        |
| A moment of interest within a span       | Span Event    |
| Detailed diagnostic information          | Log           |

### Step 2: Name It

Use the naming conventions above. Pick the pattern that matches your use case.

### Step 3: Implement It

```typescript
import { trace, metrics, SpanStatusCode, SpanKind } from "@opentelemetry/api";

const tracer = trace.getTracer("my-service");
const meter = metrics.getMeter("my-service");

// Metric for counting calls
const operationCounter = meter.createCounter("feature.operations.total", {
  description: "Total feature operations",
});

// Metric for measuring duration
const operationDuration = meter.createHistogram("feature.operation.duration", {
  description: "Feature operation duration",
  unit: "ms",
});

async function myNewFeature(input: Input): Promise<Output> {
  return tracer.startActiveSpan(
    "feature.process",
    { kind: SpanKind.INTERNAL },
    async (span) => {
      const start = performance.now();
      try {
        span.setAttribute("feature.input_size", input.size);
        span.addEvent("feature.validation.started");

        const validated = validate(input);
        span.addEvent("feature.validation.completed");

        const result = await process(validated);
        span.setAttribute("feature.output_size", result.size);

        operationCounter.add(1, { "feature.status": "success" });
        return result;
      } catch (error) {
        operationCounter.add(1, { "feature.status": "error" });
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
        span.recordException(error as Error);
        throw error;
      } finally {
        operationDuration.record(performance.now() - start);
        span.end();
      }
    }
  );
}
```

### Step 4: Manage Cardinality

See the Cardinality Management section below. Before adding an attribute, ask: "How many unique values can this have?"

### Step 5: Test It

See the Testing Instrumentation section below. Verify the function behavior is unchanged and telemetry does not throw.

---

## Cardinality Management

Cardinality is the number of unique combinations of attribute values for a metric. High cardinality causes memory bloat in your collector and backend.

| Level              | Unique Values | Safety      | Examples                          |
|--------------------|---------------|-------------|-----------------------------------|
| Low (< 20)         | Always safe   | Use freely  | HTTP method, status code class    |
| Medium (20-500)    | Usually safe  | Monitor     | Endpoint route, error code        |
| High (500+)        | Dangerous     | Use bounded | Region, tenant ID                 |
| Unbounded          | Never safe    | Never use   | Request ID, trace ID, user email  |

### Safe Attributes for Metrics

```typescript
// SAFE: bounded, low cardinality
requestCounter.add(1, {
  "http.request.method": "GET",       // ~7 values
  "http.response.status_code": 200,   // ~50 values
  "http.route": "/api/users",         // bounded by route definitions
});
```

### Dangerous Attributes for Metrics

```typescript
// DANGEROUS: unbounded cardinality -- NEVER do this on metrics
requestCounter.add(1, {
  "http.request.id": crypto.randomUUID(),  // infinite values
  "user.email": user.email,                // grows with user base
  "trace.id": span.spanContext().traceId,  // infinite values
});
```

Note: Unbounded attributes are fine on **spans** (each span is a single event). They are only dangerous on **metrics** (each unique combination creates a time series).

---

## Sampling Strategy

Application-level sampling is NOT recommended for most deployments. Here is why:

| Concern                        | Why Application Sampling Fails                        |
|--------------------------------|-------------------------------------------------------|
| Tail-based decisions           | App cannot know if a trace will be interesting later   |
| Retroactive debugging          | Dropped traces cannot be recovered                    |
| Metrics accuracy               | Counters and histograms need all data points          |
| Cost control                   | Collector-level sampling is more flexible and tunable  |

### Let the Collector Handle It

| Responsibility                  | Handle At          | Mechanism                       |
|---------------------------------|--------------------|---------------------------------|
| Drop noisy health checks        | Collector          | Filter processor                |
| Tail-based sampling             | Collector          | Tail sampling processor         |
| Rate limiting by service        | Collector          | Probabilistic sampler           |
| Cost budget enforcement         | Collector/Backend  | Usage-based quotas              |

### When Application Sampling Is Needed

In rare cases (extremely high throughput, no collector control), set these environment variables:

| Variable                         | Value                  | Effect                        |
|----------------------------------|------------------------|-------------------------------|
| `OTEL_TRACES_SAMPLER`           | `parentbased_always_on`| Default: sample everything    |
| `OTEL_TRACES_SAMPLER`           | `parentbased_traceidratio` | Probabilistic sampling    |
| `OTEL_TRACES_SAMPLER_ARG`       | `0.1`                  | Sample 10% of traces          |

```bash
# Only sample 10% of new traces (honors parent decision)
OTEL_TRACES_SAMPLER=parentbased_traceidratio OTEL_TRACES_SAMPLER_ARG=0.1 bun src/index.ts
```

---

## Telemetry Modes

Support multiple modes so developers can work without a running collector.

| Mode      | Description                | Use Case                          |
|-----------|----------------------------|-----------------------------------|
| `console` | Logs to console only       | Local development, no collector   |
| `otlp`    | Exports to OTLP endpoint   | Production, staging               |
| `both`    | Console + OTLP             | Debugging production issues       |

Implement mode switching in your initialization:

```typescript
const telemetryMode = process.env.TELEMETRY_MODE ?? "otlp";

function createSpanProcessor() {
  switch (telemetryMode) {
    case "console":
      // Import ConsoleSpanExporter for console output
      const { ConsoleSpanExporter } = require("@opentelemetry/sdk-trace-base");
      return new BatchSpanProcessor(new ConsoleSpanExporter());
    case "both":
      // Use both console and OTLP exporters
      const { ConsoleSpanExporter: ConsoleSE } = require("@opentelemetry/sdk-trace-base");
      return [
        new BatchSpanProcessor(new ConsoleSE()),
        new BatchSpanProcessor(traceExporter),
      ];
    case "otlp":
    default:
      return new BatchSpanProcessor(traceExporter);
  }
}
```

---

## Configuration Examples

### Development (Console Only)

```bash
TELEMETRY_MODE=console
OTEL_SERVICE_NAME=my-service
NODE_ENV=development
LOG_LEVEL=debug
```

### Development with Local Collector

```bash
TELEMETRY_MODE=otlp
OTEL_SERVICE_NAME=my-service
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
NODE_ENV=development
LOG_LEVEL=debug
```

### Production (OTLP Export)

```bash
TELEMETRY_MODE=otlp
OTEL_SERVICE_NAME=my-service
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.monitoring:4318
SERVICE_VERSION=1.2.3
NODE_ENV=production
LOG_LEVEL=info
```

### Kubernetes ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-service-otel-config
data:
  TELEMETRY_MODE: "otlp"
  OTEL_SERVICE_NAME: "my-service"
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector.monitoring.svc.cluster.local:4318"
  NODE_ENV: "production"
```

```yaml
# In your Deployment spec:
envFrom:
  - configMapRef:
      name: my-service-otel-config
```

### Docker Compose

```yaml
version: "3.8"
services:
  my-service:
    build: .
    ports:
      - "3000:3000"
    environment:
      TELEMETRY_MODE: otlp
      OTEL_SERVICE_NAME: my-service
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      NODE_ENV: production
    depends_on:
      - otel-collector

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    ports:
      - "4318:4318"   # OTLP HTTP
      - "4317:4317"   # OTLP gRPC
      - "8888:8888"   # Prometheus metrics
    volumes:
      - ./otel-collector-config.yaml:/etc/otel/config.yaml
    command: ["--config=/etc/otel/config.yaml"]
```

---

## Telemetry Circuit Breaker

Per-signal circuit breakers prevent cascade failures when the OTel collector is down. Without them, failed export attempts queue up and consume memory.

### Design

Three independent circuit breakers -- one each for traces, metrics, and logs. Each breaker tracks its own failure count and state transitions independently.

### Configuration

| Parameter          | Default Value | Description                                     |
|--------------------|---------------|-------------------------------------------------|
| `failureThreshold` | 5             | Consecutive failures before opening the circuit |
| `recoveryTimeout`  | 60000ms       | Time in OPEN state before trying HALF_OPEN      |
| `halfOpenMax`      | 1             | Requests allowed in HALF_OPEN to test recovery  |

### State Diagram

```
          success
    +-------------------+
    |                   |
    v     failure >= 5  |
 CLOSED ------------> OPEN
    ^                   |
    |   success         v  (after recoveryTimeout)
    +-------- HALF_OPEN +
              |
              | failure
              v
             OPEN
```

- **CLOSED**: Normal operation. Exports proceed. Failures are counted.
- **OPEN**: All exports are dropped silently. No network calls. After `recoveryTimeout`, transitions to HALF_OPEN.
- **HALF_OPEN**: Allows one test export. If it succeeds, transitions to CLOSED. If it fails, returns to OPEN.

### Implementation

```typescript
type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeoutMs: number;
}

class TelemetryCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly signal: string,
    private readonly config: CircuitBreakerConfig = {
      failureThreshold: 5,
      recoveryTimeoutMs: 60_000,
    }
  ) {}

  canExport(): boolean {
    if (this.state === "CLOSED") return true;
    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.recoveryTimeoutMs) {
        this.state = "HALF_OPEN";
        return true;
      }
      return false;
    }
    // HALF_OPEN: allow one attempt
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "CLOSED";
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.config.failureThreshold || this.state === "HALF_OPEN") {
      this.state = "OPEN";
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

// Create one breaker per signal
const traceBreaker = new TelemetryCircuitBreaker("traces");
const metricBreaker = new TelemetryCircuitBreaker("metrics");
const logBreaker = new TelemetryCircuitBreaker("logs");
```

### Environment Variable Overrides

```bash
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_RECOVERY_TIMEOUT_MS=60000
```

---

## OTLP Transformer Lazy-Loading (Bun Workaround)

### The Problem

The `protobufjs` library (used internally by OTLP exporters) allocates large buffer pools eagerly when its modules are first imported. This adds approximately 50-70MB to the heap at startup, even if you are using HTTP/JSON transport and never encode a single protobuf message.

### The Solution

Patch the module resolution so protobuf-related modules are loaded lazily -- only when actually called. This defers the buffer pool allocation until (and unless) protobuf encoding is needed.

```typescript
// src/patches/otlp-lazy-loader.ts
const LAZY_MODULES = [
  "@opentelemetry/otlp-transformer",
  "@opentelemetry/otlp-proto-exporter-base",
];

function patchRequire(): void {
  const originalResolve = require.resolve;

  for (const moduleName of LAZY_MODULES) {
    try {
      const modulePath = originalResolve(moduleName);
      // Replace with a proxy that only loads on first property access
      const handler: ProxyHandler<object> = {
        get(target, prop, receiver) {
          // Load the real module on first access
          if (!Reflect.has(target, "__loaded")) {
            const real = require(modulePath);
            Object.assign(target, real);
            Object.defineProperty(target, "__loaded", { value: true });
          }
          return Reflect.get(target, prop, receiver);
        },
      };
      require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports: new Proxy({}, handler),
      } as NodeModule;
    } catch {
      // Module not installed -- skip
    }
  }
}
```

### Memory Impact

| Configuration       | Startup Heap | Notes                                |
|---------------------|-------------|---------------------------------------|
| No lazy loading     | ~120 MB     | protobufjs pools allocated eagerly    |
| With lazy loading   | ~55 MB      | Pools deferred until first encode     |
| Savings             | ~65 MB      | Significant for container memory limits |

### Caveat

Under sustained high-throughput load, Bun's JIT compiler may trigger the lazy getters earlier than expected during module optimization passes. The memory savings still apply at startup, but the pools will eventually be allocated once the first export occurs.

---

## Testing Instrumentation

### Testing Spans

Telemetry should not change observable behavior. Test the function, not the spans.

```typescript
import { describe, it, expect } from "bun:test";

describe("processOrder", () => {
  it("returns a valid order for valid input", () => {
    const result = processOrder("order-123");
    expect(result).toBeDefined();
    expect(result.id).toBe("order-123");
  });

  it("throws on invalid order ID", () => {
    expect(() => processOrder("")).toThrow("Invalid order ID");
  });
});
```

### Testing Metrics

Verify that metric recording does not throw, but do not assert on specific metric values in unit tests.

```typescript
describe("request metrics", () => {
  it("records duration without error", () => {
    expect(() => {
      requestDuration.record(42.5, {
        "http.request.method": "GET",
        "http.route": "/api/users",
      });
    }).not.toThrow();
  });
});
```

### Testing with InMemorySpanExporter

For integration tests where you need to assert on actual spans produced:

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { trace } from "@opentelemetry/api";

const memoryExporter = new InMemorySpanExporter();

beforeEach(() => {
  memoryExporter.reset();
});

// One-time setup
const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(memoryExporter));
provider.register();

describe("tracing integration", () => {
  it("produces a span for order processing", async () => {
    const tracer = trace.getTracer("test");
    tracer.startActiveSpan("order.process", (span) => {
      span.setAttribute("order.id", "test-123");
      span.end();
    });

    const spans = memoryExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("order.process");
    expect(spans[0].attributes["order.id"]).toBe("test-123");
  });
});
```

### Suppressing Telemetry in Tests

Set these environment variables to prevent telemetry noise during test runs:

```bash
LOG_LEVEL=silent
TELEMETRY_MODE=console
```

Or in your test preload script:

```typescript
// test/preload.ts
process.env.LOG_LEVEL = "silent";
process.env.TELEMETRY_MODE = "console";
```

---

## Troubleshooting

### Spans Not Appearing in Backend

1. **Check `TELEMETRY_MODE`**: Must be `otlp` or `both`. If set to `console`, spans go to stdout only.
2. **Check `OTEL_EXPORTER_OTLP_ENDPOINT`**: Verify the endpoint is reachable from your application.
3. **Check the collector is running**: `curl http://localhost:4318/v1/traces` should return a response (even if 405).
4. **Check span.end() is called**: Unended spans are never exported. Always use `finally` blocks.
5. **Check the import order**: `src/telemetry.ts` must be imported before any instrumented modules.

### High Memory at Startup

- **Cause**: OTLP transformer protobufjs allocates ~50-70MB eagerly.
- **Solution**: Apply the lazy-loading patch described in the OTLP Transformer Lazy-Loading section.
- **Verification**: Check `process.memoryUsage().heapUsed` before and after the patch.

### Metrics Cardinality Explosion

- **Symptom**: Collector memory grows unboundedly; backend ingestion slows or rejects data.
- **Cause**: Metric attributes with unbounded values (request IDs, user IDs, timestamps).
- **Solution**: Audit all `counter.add()` and `histogram.record()` calls. Remove or bucket high-cardinality attributes. See the Cardinality Management section.
- **Detection**: Check your collector's `otelcol_processor_dropped_metric_points` metric.

### Circuit Breaker Stuck Open

- **Symptom**: No telemetry exported despite collector being available.
- **Cause**: Circuit breaker opened after repeated failures and `recoveryTimeout` has not elapsed, or HALF_OPEN test keeps failing.
- **Solution**: Check collector connectivity. Review circuit breaker state via a health/debug endpoint. Restart the application to reset breaker state.

### Bun-Specific Issues

| Issue                                  | Cause                                    | Workaround                                    |
|----------------------------------------|------------------------------------------|------------------------------------------------|
| gRPC export fails                      | Bun has incomplete gRPC support          | Use OTLP/HTTP (JSON) exclusively               |
| `fetch` hangs to remote IPs           | Bun networking bug with non-localhost    | Use `curl` subprocess as fallback               |
| Auto-instrumentation partial           | Not all Node.js modules are supported    | Verify specific instrumentations you need       |
| `process.on("SIGTERM")` not firing    | Server not handling shutdown signals     | Register handlers before `Bun.serve()`          |

### No Metrics Exported

1. **Check `PeriodicExportingMetricReader` interval**: Default is 30 seconds. Wait at least one interval.
2. **Check metric exporter endpoint**: Verify `/v1/metrics` path is appended to the OTLP endpoint.
3. **Check for errors in stderr**: OTLP exporters log failures to stderr by default.
4. **Verify meter is retrieved**: `metrics.getMeter("my-service")` must be called after SDK initialization.

### Logs Not Correlated with Traces

- **Cause**: `LoggerProvider` not registered globally.
- **Solution**: Call `logs.setGlobalLoggerProvider(loggerProvider)` during initialization. See the SDK Initialization section.
- **Verification**: Log records should contain `trace_id` and `span_id` fields when emitted within an active span context.
