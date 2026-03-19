# kafka-mcp-server

An MCP (Model Context Protocol) server that exposes Apache Kafka operations as tools for AI assistants. Supports local Kafka, AWS MSK, and Confluent Cloud.

## Tools

12 tools organized by operation type:

### Read (always available)

| Tool | Description |
|------|-------------|
| `kafka_list_topics` | List available topics with optional filtering |
| `kafka_describe_topic` | Get detailed topic info (partitions, offsets, configs) |
| `kafka_get_topic_offsets` | Retrieve offset information for a topic |
| `kafka_consume_messages` | Consume messages from a topic |
| `kafka_list_consumer_groups` | List consumer groups with optional filtering |
| `kafka_describe_consumer_group` | Get detailed consumer group information |
| `kafka_get_cluster_info` | Get cluster metadata and topology |

### Write (requires `KAFKA_ALLOW_WRITES=true`)

| Tool | Description |
|------|-------------|
| `kafka_produce_message` | Publish messages to a topic |
| `kafka_create_topic` | Create a new topic |
| `kafka_alter_topic_config` | Modify topic configuration |

### Destructive (requires `KAFKA_ALLOW_DESTRUCTIVE=true`)

| Tool | Description |
|------|-------------|
| `kafka_delete_topic` | Delete a topic (irreversible) |
| `kafka_reset_consumer_group_offsets` | Reset consumer group offsets |

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

## MCP client integration

### Claude Desktop

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

### Claude Code

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

## Configuration reference

| Variable | Description | Default |
|----------|-------------|---------|
| `KAFKA_PROVIDER` | Provider type: `local`, `msk`, `confluent` | `local` |
| `KAFKA_CLIENT_ID` | Kafka client identifier | `kafka-mcp-server` |
| `KAFKA_ALLOW_WRITES` | Enable write tools | `false` |
| `KAFKA_ALLOW_DESTRUCTIVE` | Enable destructive tools | `false` |
| `KAFKA_CONSUME_MAX_MESSAGES` | Max messages per consume call | `50` |
| `KAFKA_CONSUME_TIMEOUT_MS` | Consume timeout in milliseconds | `30000` |
| `LOCAL_BOOTSTRAP_SERVERS` | Local broker addresses | `localhost:9092` |
| `MSK_BOOTSTRAP_BROKERS` | MSK broker addresses | -- |
| `MSK_CLUSTER_ARN` | MSK cluster ARN (for broker discovery) | -- |
| `AWS_REGION` | AWS region for MSK | `eu-west-1` |
| `CONFLUENT_BOOTSTRAP_SERVERS` | Confluent broker addresses | -- |
| `CONFLUENT_API_KEY` | Confluent API key | -- |
| `CONFLUENT_API_SECRET` | Confluent API secret | -- |
| `CONFLUENT_REST_ENDPOINT` | Confluent REST API endpoint | -- |
| `CONFLUENT_CLUSTER_ID` | Confluent cluster ID | -- |
| `LOG_LEVEL` | Log level: `silent`, `debug`, `info`, `warn`, `error` | `info` |
| `LOGGING_BACKEND` | Logging backend | `pino` |
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
