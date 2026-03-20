# Local Setup Guide

Get the Kafka MCP Server running against a local Kafka broker in under 5 minutes.

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- A running Kafka broker on `localhost:9092` (or use the DevContainer)

## Option A: DevContainer (recommended)

The project includes a DevContainer that starts the full Kafka ecosystem automatically.

1. Open the project in VS Code (or any DevContainer-compatible editor)
2. When prompted, click **Reopen in Container**
3. All services start automatically:

| Service | Port | URL |
|---|---|---|
| Kafka (KRaft) | 9092 | `localhost:9092` |
| Schema Registry | 8081 | `http://localhost:8081` |
| ksqlDB | 8088 | `http://localhost:8088` |
| Kafka UI | 8080 | `http://localhost:8080` |
| Flink Web UI | 18081 | `http://localhost:18081` |
| Flink SQL Gateway | 8083 | `http://localhost:8083` |

The DevContainer pre-configures the environment with all MCP features enabled (Schema Registry, ksqlDB, writes, destructive ops) and debug logging. All 30 MCP tools work out of the box.

Apache Flink (jobmanager, taskmanager, SQL gateway) is included for stream processing experimentation but has no MCP integration -- it is infrastructure only.

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

If you have a local Schema Registry running (e.g., via Docker Compose):

```env
SCHEMA_REGISTRY_ENABLED=true
SCHEMA_REGISTRY_URL=http://localhost:8081
```

This adds 8 schema tools (list, get, register, compatibility check, config, delete).

## Adding ksqlDB

If you have a local ksqlDB server:

```env
KSQL_ENABLED=true
KSQL_ENDPOINT=http://localhost:8088
```

This adds 7 ksqlDB tools (server info, streams, tables, queries, describe, run query, execute statement).

## Integrating with Claude

### Claude Desktop

Add to your `claude_desktop_config.json`:

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

Add to your `.claude/settings.json`:

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

Build first with `bun run build`, then point `args` at the built output in `dist/index.js`.

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
