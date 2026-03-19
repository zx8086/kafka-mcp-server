# Kafka MCP Server

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
  services/     KafkaService (operations) + KafkaClientManager (lifecycle)
  tools/        MCP tool definitions by category
    read/       7 read-only tools (always available)
    write/      3 write tools (gated by KAFKA_ALLOW_WRITES)
    destructive/  2 destructive tools (gated by KAFKA_ALLOW_DESTRUCTIVE)
    shared/     Shared utilities (wrap.ts for universal handler wrapping)
  lib/          Error handling, response builder
  logging/      Pino logger with ECS formatting, singleton container
  telemetry/    OpenTelemetry init, tracing decorator
  index.ts      Entry point: config -> logger -> telemetry -> provider -> service -> tools -> stdio
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

12 MCP tools in 3 categories:

**Read** (7): `kafka_list_topics`, `kafka_describe_topic`, `kafka_get_topic_offsets`, `kafka_consume_messages`, `kafka_list_consumer_groups`, `kafka_describe_consumer_group`, `kafka_get_cluster_info`

**Write** (3): `kafka_produce_message`, `kafka_create_topic`, `kafka_alter_topic_config`

**Destructive** (2): `kafka_delete_topic`, `kafka_reset_consumer_group_offsets`

Permission gates checked in `src/tools/wrap.ts` via `wrapHandler()` before any handler executes.

## Testing

```bash
bun test
```
