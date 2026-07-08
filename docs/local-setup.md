# Local Setup Guide

Get the Kafka MCP Server running against a local Kafka broker in under 5 minutes.

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- A running Kafka broker on `localhost:9092` (or use the DevContainer)

## Option A: Docker Compose stack (recommended)

The project includes a Docker Compose stack with the full Kafka ecosystem. Start it from the project root:

```bash
docker compose -f .devcontainer/docker-compose.yml up -d
```

Wait for all services to become healthy:

```bash
docker compose -f .devcontainer/docker-compose.yml ps
```

| Service | Port | URL |
|---|---|---|
| Kafka (KRaft) | 9092 | `localhost:9092` |
| Schema Registry | 8081 | `http://localhost:8081` |
| ksqlDB | 8088 | `http://localhost:8088` |
| Kafka UI | 8080 | `http://localhost:8080` |
| Flink Web UI | 18081 | `http://localhost:18081` |
| Flink SQL Gateway | 8083 | `http://localhost:8083` |

Start the MCP server with the pre-configured env file:

```bash
bun --env-file=.env.devcontainer run src/index.ts
```

All MCP features are pre-enabled (Schema Registry, ksqlDB, writes, destructive ops) with debug logging. All 30 MCP tools work out of the box.

Apache Flink (jobmanager, taskmanager, SQL gateway) is included for stream processing experimentation but has no MCP integration -- it is infrastructure only.

To stop everything:

```bash
docker compose -f .devcontainer/docker-compose.yml down      # keep data
docker compose -f .devcontainer/docker-compose.yml down -v    # remove volumes
```

## Option B: Bring your own Kafka

If you already have Kafka running (Docker, Homebrew, etc.), just point the server at it.

### 1. Install dependencies

```bash
bun install
```

### 2. Create your .env file

```bash
cp .env.example .env
```

The defaults work out of the box for a local broker on `localhost:9092`:

```env
KAFKA_PROVIDER=local
LOCAL_BOOTSTRAP_SERVERS=localhost:9092
```

If your broker is on a different host or port, update `LOCAL_BOOTSTRAP_SERVERS`.

### 3. Start the server

```bash
# Run from source
bun run dev

# Or with hot reload for development
bun run dev:hot
```

### 4. Test with MCP Inspector

```bash
bun run build:inspector
```

This builds the project and launches the MCP Inspector, where you can call tools interactively.

## Enabling write and destructive operations

By default, only read tools are active. To enable all tools:

```env
KAFKA_ALLOW_WRITES=true
KAFKA_ALLOW_DESTRUCTIVE=true
```

## Adding Schema Registry

Schema Registry is included in the Docker Compose stack (Option A). For a standalone Schema Registry:

```env
SCHEMA_REGISTRY_ENABLED=true
SCHEMA_REGISTRY_URL=http://localhost:8081
```

This adds 8 schema tools (list, get, register, compatibility check, config, delete).

## Adding ksqlDB

ksqlDB is included in the Docker Compose stack (Option A). For a standalone ksqlDB server:

```env
KSQL_ENABLED=true
KSQL_ENDPOINT=http://localhost:8088
```

This adds 7 ksqlDB tools (server info, streams, tables, queries, describe, run query, execute statement).

## Integrating with Claude

### Claude Desktop

Add to your `claude_desktop_config.json`. The minimal config enables only Kafka read tools:

```json
{
  "mcpServers": {
    "kafka": {
      "command": "bun",
      "args": ["/absolute/path/to/kafka-mcp-server/src/index.ts"],
      "env": {
        "KAFKA_PROVIDER": "local",
        "LOCAL_BOOTSTRAP_SERVERS": "localhost:9092"
      }
    }
  }
}
```

To enable all 30 tools with the Docker Compose stack:

```json
{
  "mcpServers": {
    "kafka": {
      "command": "bun",
      "args": ["/absolute/path/to/kafka-mcp-server/src/index.ts"],
      "env": {
        "KAFKA_PROVIDER": "local",
        "LOCAL_BOOTSTRAP_SERVERS": "localhost:9092",
        "KAFKA_ALLOW_WRITES": "true",
        "KAFKA_ALLOW_DESTRUCTIVE": "true",
        "SCHEMA_REGISTRY_ENABLED": "true",
        "SCHEMA_REGISTRY_URL": "http://localhost:8081",
        "KSQL_ENABLED": "true",
        "KSQL_ENDPOINT": "http://localhost:8088"
      }
    }
  }
}
```

### Claude Code

Add to your `.claude/settings.json`. The minimal config enables only Kafka read tools:

```json
{
  "mcpServers": {
    "kafka": {
      "command": "bun",
      "args": ["/absolute/path/to/kafka-mcp-server/src/index.ts"],
      "env": {
        "KAFKA_PROVIDER": "local",
        "LOCAL_BOOTSTRAP_SERVERS": "localhost:9092"
      }
    }
  }
}
```

To enable all 30 tools with the Docker Compose stack:

```json
{
  "mcpServers": {
    "kafka": {
      "command": "bun",
      "args": ["/absolute/path/to/kafka-mcp-server/src/index.ts"],
      "env": {
        "KAFKA_PROVIDER": "local",
        "LOCAL_BOOTSTRAP_SERVERS": "localhost:9092",
        "KAFKA_ALLOW_WRITES": "true",
        "KAFKA_ALLOW_DESTRUCTIVE": "true",
        "SCHEMA_REGISTRY_ENABLED": "true",
        "SCHEMA_REGISTRY_URL": "http://localhost:8081",
        "KSQL_ENABLED": "true",
        "KSQL_ENDPOINT": "http://localhost:8088"
      }
    }
  }
}
```

## Troubleshooting

**Connection refused on port 9092**
Kafka is not running or is on a different port. Check with:
```bash
lsof -i :9092
```

**Tools return timeout errors**
Increase the consume timeout:
```env
KAFKA_CONSUME_TIMEOUT_MS=60000
```

**Debug logging**
Set the log level to see detailed request/response information:
```env
LOG_LEVEL=debug
```
