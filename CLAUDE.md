# Kafka MCP Server

## Critical Rules

### Workflow
- **NEVER commit** without explicit user authorization
- **Team**: "Siobytes" | Commit format: `SIO-XX: message`
- Linear Project: [Kafka MCP Server](https://linear.app/siobytes/project/kafka-mcp-server-fdd6c229b8a5)
- **ALWAYS add Linear issues to the "Kafka MCP Server" project** when creating new issues

### Linear Issue Management
- **Assignee**: Always assign issues to "me" (Simon Owusu)
- **Epic naming**: `Epic N: <Title>` (e.g., `Epic 1: Migrate AI Agent to LangGraph`)
- **Sub-issue naming**: `<Phase>.<Order>: <Title>` (e.g., `1.1: Infrastructure Setup`, `2.3: Migrate index tools`)
- **Phase grouping**:
  - Phase 1.x: Foundation/Setup
  - Phase 2.x: Core implementation
  - Phase 3.x: Component implementation
  - Phase 4.x: Assembly/Integration
  - Phase 5.x: Testing/Cleanup

## Runtime

Default to Bun instead of Node.js.

- Use `bun <file>` instead of `node` or `ts-node`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install`
- Use `bun run <script>` instead of `npm run <script>`
- Bun automatically loads `.env` -- don't use dotenv
- Prefer `Bun.file` over `node:fs` readFile/writeFile
- Use `Bun.$` for shell commands instead of execa

## Architecture

Layered design: config -> providers -> services -> tools

```
src/
  config/       Env-driven config: mapping, defaults, Zod schemas, loader
  providers/    Kafka provider abstractions (local, msk, confluent)
  services/     KafkaService + SchemaRegistryService + KsqlService + KafkaClientManager
  tools/        MCP tool definitions by category
    read/       10 read-only tools (always available)
    write/      3 write tools (gated by KAFKA_ALLOW_WRITES)
    destructive/  2 destructive tools (gated by KAFKA_ALLOW_DESTRUCTIVE)
    schema/     8 Schema Registry tools (gated by SCHEMA_REGISTRY_ENABLED)
    ksql/       7 ksqlDB tools (gated by KSQL_ENABLED)
    shared/     Shared parameter definitions
  transport/    Transport abstraction layer
    stdio.ts    StdioServerTransport lifecycle
    http.ts     Bun.serve() + WebStandardStreamableHTTPServerTransport
    middleware.ts HOF security wrappers (withOriginValidation, withApiKeyAuth)
    factory.ts  Transport selection based on MCP_TRANSPORT
  lib/          Error handling, response builder
  logging/      Pino logger with ECS formatting, singleton container
  telemetry/    OpenTelemetry init, tracing decorator
  index.ts      Entry point: config -> logger -> telemetry -> provider -> services -> serverFactory -> transport
```

## Configuration

4-pillar pattern: defaults (`defaults.ts`) -> env mapping (`env-mapping.ts`) -> Zod validation (`schemas.ts`) -> singleton cache (`config.ts`).

All config is env-driven. See `src/config/env-mapping.ts` for the full variable list.

## Providers

Three providers implementing `KafkaProvider` interface:

- **local** -- No auth, plain TCP to `LOCAL_BOOTSTRAP_SERVERS`
- **msk** -- IAM OAUTHBEARER via `aws-msk-iam-sasl-signer-js`, TLS, optional broker discovery from cluster ARN
- **confluent** -- PLAIN SASL (API key/secret), TLS, optional REST client for enriched metadata

Factory in `src/providers/factory.ts` selects by `KAFKA_PROVIDER` env var.

## Tools

30 MCP tools in 5 categories:

**Core Read** (10): `kafka_list_topics`, `kafka_describe_topic`, `kafka_get_topic_offsets`, `kafka_consume_messages`, `kafka_list_consumer_groups`, `kafka_describe_consumer_group`, `kafka_get_cluster_info`, `kafka_get_consumer_group_lag`, `kafka_describe_cluster`, `kafka_get_message_by_offset`

**Core Write** (3): `kafka_produce_message`, `kafka_create_topic`, `kafka_alter_topic_config`

**Core Destructive** (2): `kafka_delete_topic`, `kafka_reset_consumer_group_offsets`

**Schema Registry** (8, requires `SCHEMA_REGISTRY_ENABLED=true`): `kafka_list_schemas`, `kafka_get_schema`, `kafka_get_schema_versions`, `kafka_register_schema` (write), `kafka_check_compatibility`, `kafka_get_schema_config`, `kafka_set_schema_config` (write), `kafka_delete_schema_subject` (destructive)

**ksqlDB** (7, requires `KSQL_ENABLED=true`): `ksql_get_server_info`, `ksql_list_streams`, `ksql_list_tables`, `ksql_list_queries`, `ksql_describe`, `ksql_run_query`, `ksql_execute_statement` (write)

Permission gates checked in `src/tools/wrap.ts` via `wrapHandler()` before any handler executes. Feature gates (Schema Registry, ksqlDB) are checked before permission gates (write, destructive).

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

## Testing

```bash
bun test
```
