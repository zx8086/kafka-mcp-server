# kafka-mcp-server

An MCP (Model Context Protocol) server that exposes Apache Kafka operations as tools for AI assistants. Supports local Kafka, AWS MSK, and Confluent Cloud -- with optional Schema Registry and ksqlDB integration.

## Tools

30 tools organized by operation type:

### Core Kafka -- Read (always available)

| Tool | Description |
|------|-------------|
| `kafka_list_topics` | List available topics with optional filtering |
| `kafka_describe_topic` | Get detailed topic info (partitions, offsets, configs) |
| `kafka_get_topic_offsets` | Retrieve offset information for a topic |
| `kafka_consume_messages` | Consume messages from a topic |
| `kafka_list_consumer_groups` | List consumer groups with optional filtering |
| `kafka_describe_consumer_group` | Get detailed consumer group information |
| `kafka_get_cluster_info` | Get cluster metadata and topology |
| `kafka_get_consumer_group_lag` | Calculate per-partition and total consumer group lag |
| `kafka_describe_cluster` | Get broker-level metadata (IDs, hosts, racks, controller) |
| `kafka_get_message_by_offset` | Retrieve a single message by topic, partition, and offset |

### Core Kafka -- Write (requires `KAFKA_ALLOW_WRITES=true`)

| Tool | Description |
|------|-------------|
| `kafka_produce_message` | Publish messages to a topic |
| `kafka_create_topic` | Create a new topic |
| `kafka_alter_topic_config` | Modify topic configuration |

### Core Kafka -- Destructive (requires `KAFKA_ALLOW_DESTRUCTIVE=true`)

| Tool | Description |
|------|-------------|
| `kafka_delete_topic` | Delete a topic (irreversible) |
| `kafka_reset_consumer_group_offsets` | Reset consumer group offsets |

### Schema Registry (requires `SCHEMA_REGISTRY_ENABLED=true`)

| Tool | Permission | Description |
|------|------------|-------------|
| `kafka_list_schemas` | Read | List all registered schema subjects |
| `kafka_get_schema` | Read | Retrieve a schema by subject and version |
| `kafka_get_schema_versions` | Read | List version numbers for a subject |
| `kafka_check_compatibility` | Read | Test schema compatibility before registering |
| `kafka_get_schema_config` | Read | Get compatibility config (subject or global) |
| `kafka_register_schema` | Write | Register a new schema version |
| `kafka_set_schema_config` | Write | Set compatibility level |
| `kafka_delete_schema_subject` | Destructive | Delete a schema subject and all versions |

### ksqlDB (requires `KSQL_ENABLED=true`)

| Tool | Permission | Description |
|------|------------|-------------|
| `ksql_get_server_info` | Read | Get ksqlDB server version and status |
| `ksql_list_streams` | Read | List all ksqlDB streams |
| `ksql_list_tables` | Read | List all ksqlDB materialized tables |
| `ksql_list_queries` | Read | List running persistent queries |
| `ksql_describe` | Read | Describe a stream or table schema |
| `ksql_run_query` | Read | Execute pull or limited push queries |
| `ksql_execute_statement` | Write | Execute DDL/DML statements (CREATE, DROP, etc.) |

## Quick start

```bash
bun install
```

Create a `.env` file (Bun loads it automatically):

```env
KAFKA_PROVIDER=local
LOCAL_BOOTSTRAP_SERVERS=localhost:9092
```

### Development

```bash
bun run dev          # run from source
bun run dev:hot      # run with hot reload
```

### Production

```bash
bun run build        # bundle to dist/
bun run start        # run the built bundle
```

### MCP Inspector

Test tools interactively:

```bash
bun run build:inspector   # build + launch inspector
```

## Transport modes

The server supports two transport modes, controlled by `MCP_TRANSPORT`:

- **stdio** (default) -- for CLI tools and desktop apps. The server is spawned as a child process.
- **http** -- for remote access and multi-client scenarios. Runs a `Bun.serve()` HTTP server with the MCP Streamable HTTP protocol.
- **both** -- runs stdio and HTTP simultaneously. Useful for development (Claude Code via stdio + MCP Inspector via HTTP).

### HTTP mode

Start the server with HTTP transport:

```env
MCP_TRANSPORT=http
MCP_PORT=3000
MCP_HOST=127.0.0.1
MCP_PATH=/mcp
```

The server accepts MCP requests at `http://127.0.0.1:3000/mcp` using the Streamable HTTP protocol (POST for requests, GET for SSE streams in stateful mode, DELETE for session termination).

#### Session modes

- **stateless** (default) -- a fresh server instance is created per request. Suitable for most Kafka operations.
- **stateful** -- sessions persist across requests, reusing Kafka connections. Set `MCP_SESSION_MODE=stateful`.

#### Security

For remote deployments, configure authentication and origin validation:

```env
MCP_API_KEY=your-secret-key           # requires Authorization: Bearer your-secret-key
MCP_ALLOWED_ORIGINS=http://localhost:3001,https://app.example.com
```

The server binds to `127.0.0.1` by default. Set `MCP_HOST=0.0.0.0` to accept connections from other machines (combine with `MCP_API_KEY` for security).

## MCP client integration

### Claude Desktop (stdio)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kafka": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/kafka-mcp-server/dist/index.js"],
      "env": {
        "KAFKA_PROVIDER": "local",
        "LOCAL_BOOTSTRAP_SERVERS": "localhost:9092"
      }
    }
  }
}
```

### Claude Desktop (HTTP)

Start the server with `MCP_TRANSPORT=http`, then add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kafka": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Claude Code (stdio)

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "kafka": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/kafka-mcp-server/dist/index.js"],
      "env": {
        "KAFKA_PROVIDER": "local",
        "LOCAL_BOOTSTRAP_SERVERS": "localhost:9092"
      }
    }
  }
}
```

### Claude Code (HTTP)

Start the server with `MCP_TRANSPORT=http`, then add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "kafka": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Shared team server

Deploy a single HTTP instance that multiple team members connect to:

```env
MCP_TRANSPORT=http
MCP_HOST=0.0.0.0
MCP_PORT=3000
MCP_API_KEY=team-shared-secret
KAFKA_PROVIDER=confluent
CONFLUENT_BOOTSTRAP_SERVERS=pkc-abc12.eu-west-1.aws.confluent.cloud:9092
CONFLUENT_API_KEY=your-api-key
CONFLUENT_API_SECRET=your-api-secret
```

Team members configure their MCP client with:

```json
{
  "mcpServers": {
    "kafka": {
      "url": "http://kafka-mcp.internal:3000/mcp",
      "headers": {
        "Authorization": "Bearer team-shared-secret"
      }
    }
  }
}
```

## Providers

### Local

```env
KAFKA_PROVIDER=local
LOCAL_BOOTSTRAP_SERVERS=localhost:9092
```

### AWS MSK

Uses IAM OAUTHBEARER authentication via `aws-msk-iam-sasl-signer-js`. Requires valid AWS credentials in the environment.

```env
KAFKA_PROVIDER=msk
MSK_BOOTSTRAP_BROKERS=b-1.cluster.abc123.kafka.eu-west-1.amazonaws.com:9098
MSK_CLUSTER_ARN=arn:aws:kafka:eu-west-1:123456789:cluster/my-cluster/abc-123
AWS_REGION=eu-west-1
```

Either `MSK_BOOTSTRAP_BROKERS` or `MSK_CLUSTER_ARN` is required (if only the ARN is provided, brokers are discovered automatically).

### Confluent Cloud

Uses PLAIN SASL authentication with API key/secret.

```env
KAFKA_PROVIDER=confluent
CONFLUENT_BOOTSTRAP_SERVERS=pkc-abc12.eu-west-1.aws.confluent.cloud:9092
CONFLUENT_API_KEY=your-api-key
CONFLUENT_API_SECRET=your-api-secret
CONFLUENT_REST_ENDPOINT=https://pkc-abc12.eu-west-1.aws.confluent.cloud:443
CONFLUENT_CLUSTER_ID=lkc-abc123
```

## Optional integrations

### Schema Registry

Works with Confluent Schema Registry (cloud or self-hosted). Supports Avro, JSON Schema, and Protobuf.

```env
SCHEMA_REGISTRY_ENABLED=true
SCHEMA_REGISTRY_URL=http://localhost:8081
SCHEMA_REGISTRY_API_KEY=       # optional, for Confluent Cloud or basic auth
SCHEMA_REGISTRY_API_SECRET=    # optional, for Confluent Cloud or basic auth
```

For Confluent Cloud, use the Schema Registry API key/secret (different from the Kafka cluster credentials).

### ksqlDB

Works with ksqlDB (self-hosted or Confluent Cloud). Provides SQL-like access to Kafka streams and tables.

```env
KSQL_ENABLED=true
KSQL_ENDPOINT=http://localhost:8088
KSQL_API_KEY=                  # optional, for Confluent Cloud or basic auth
KSQL_API_SECRET=               # optional, for Confluent Cloud or basic auth
```

## Configuration reference

### Core

| Variable | Description | Default |
|----------|-------------|---------|
| `KAFKA_PROVIDER` | Provider type: `local`, `msk`, `confluent` | `local` |
| `KAFKA_CLIENT_ID` | Kafka client identifier | `kafka-mcp-server` |
| `KAFKA_ALLOW_WRITES` | Enable write tools | `false` |
| `KAFKA_ALLOW_DESTRUCTIVE` | Enable destructive tools | `false` |
| `KAFKA_CONSUME_MAX_MESSAGES` | Max messages per consume call | `50` |
| `KAFKA_CONSUME_TIMEOUT_MS` | Consume timeout in milliseconds | `30000` |

### Local provider

| Variable | Description | Default |
|----------|-------------|---------|
| `LOCAL_BOOTSTRAP_SERVERS` | Local broker addresses | `localhost:9092` |

### AWS MSK provider

| Variable | Description | Default |
|----------|-------------|---------|
| `MSK_BOOTSTRAP_BROKERS` | MSK broker addresses | -- |
| `MSK_CLUSTER_ARN` | MSK cluster ARN (for broker discovery) | -- |
| `AWS_REGION` | AWS region for MSK | `eu-west-1` |

### Confluent Cloud provider

| Variable | Description | Default |
|----------|-------------|---------|
| `CONFLUENT_BOOTSTRAP_SERVERS` | Confluent broker addresses | -- |
| `CONFLUENT_API_KEY` | Confluent API key | -- |
| `CONFLUENT_API_SECRET` | Confluent API secret | -- |
| `CONFLUENT_REST_ENDPOINT` | Confluent REST API endpoint | -- |
| `CONFLUENT_CLUSTER_ID` | Confluent cluster ID | -- |

### Schema Registry

| Variable | Description | Default |
|----------|-------------|---------|
| `SCHEMA_REGISTRY_ENABLED` | Enable Schema Registry tools | `false` |
| `SCHEMA_REGISTRY_URL` | Schema Registry URL | `http://localhost:8081` |
| `SCHEMA_REGISTRY_API_KEY` | API key for authentication | -- |
| `SCHEMA_REGISTRY_API_SECRET` | API secret for authentication | -- |

### ksqlDB

| Variable | Description | Default |
|----------|-------------|---------|
| `KSQL_ENABLED` | Enable ksqlDB tools | `false` |
| `KSQL_ENDPOINT` | ksqlDB REST API endpoint | `http://localhost:8088` |
| `KSQL_API_KEY` | API key for authentication | -- |
| `KSQL_API_SECRET` | API secret for authentication | -- |

### Transport

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_TRANSPORT` | Transport mode: `stdio`, `http`, `both` | `stdio` |
| `MCP_PORT` | HTTP server port | `3000` |
| `MCP_HOST` | HTTP server bind address | `127.0.0.1` |
| `MCP_PATH` | MCP endpoint path | `/mcp` |
| `MCP_SESSION_MODE` | HTTP session mode: `stateless`, `stateful` | `stateless` |
| `MCP_API_KEY` | Bearer token for HTTP authentication | -- |
| `MCP_ALLOWED_ORIGINS` | Comma-separated allowed origins | -- |
| `MCP_IDLE_TIMEOUT` | HTTP idle timeout in seconds | `120` |

### Logging

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Log level: `silent`, `debug`, `info`, `warn`, `error` | `info` |
| `LOGGING_BACKEND` | Logging backend | `pino` |

### Telemetry

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEMETRY_ENABLED` | Enable OpenTelemetry | `false` |
| `TELEMETRY_SERVICE_NAME` | OTel service name | `kafka-mcp-server` |
| `TELEMETRY_MODE` | OTel export mode: `console`, `otlp`, `both` | `console` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP exporter endpoint | `http://localhost:4318` |

## Permissions

Write and destructive tools are disabled by default. Enable them explicitly:

```env
KAFKA_ALLOW_WRITES=true
KAFKA_ALLOW_DESTRUCTIVE=true
```

Permission gates apply across all tool categories:

| Permission | Kafka tools | Schema Registry tools | ksqlDB tools |
|------------|------------|----------------------|-------------|
| Read | Always | `SCHEMA_REGISTRY_ENABLED` | `KSQL_ENABLED` |
| Write | `KAFKA_ALLOW_WRITES` | Both flags required | Both flags required |
| Destructive | `KAFKA_ALLOW_DESTRUCTIVE` | Both flags required | -- |

When a tool is called without the required permission, the server returns an error message indicating which flag to set.

## Observability

### Logging

Pino-based structured logging with ECS-compatible formatting. Set `LOG_LEVEL` to control verbosity. In local provider mode, `pino-pretty` is used automatically if available.

### OpenTelemetry

Traces and metrics export via OTLP HTTP. Enable with:

```env
TELEMETRY_ENABLED=true
TELEMETRY_MODE=otlp
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Use `TELEMETRY_MODE=console` for local debugging or `both` for dual export.

## Development

### DevContainer

The project includes a DevContainer configuration with:

- Apache Kafka in KRaft mode (single-node, port 9092)
- Kafka UI dashboard (port 8080)
- Pre-configured environment: local provider, writes and destructive ops enabled, debug logging

Open in VS Code or any DevContainer-compatible editor to get a ready-to-use Kafka environment.

### Testing

```bash
bun test
```
