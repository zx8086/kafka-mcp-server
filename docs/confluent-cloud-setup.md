# Confluent Cloud Setup Guide

Connect the Kafka MCP Server to a Confluent Cloud cluster with optional Schema Registry and ksqlDB.

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- A Confluent Cloud account with an active Kafka cluster
- A Confluent Cloud API key and secret for the cluster

## 1. Gather your Confluent Cloud credentials

You need these values from your Confluent Cloud console:

| Value | Where to find it |
|-------|-----------------|
| Bootstrap server | Cluster Settings > Endpoints > Bootstrap server |
| API key | API Keys > Create key (select the cluster) |
| API secret | Shown once when creating the API key |
| REST endpoint | Cluster Settings > Endpoints > REST endpoint (optional) |
| Cluster ID | Cluster Settings > General > Cluster ID (optional) |

## 2. Install dependencies

```bash
bun install
```

## 3. Create your .env file

```bash
cp .env.example .env
```

Fill in the Confluent Cloud section:

```env
KAFKA_PROVIDER=confluent
CONFLUENT_BOOTSTRAP_SERVERS=pkc-abc12.eu-west-1.aws.confluent.cloud:9092
CONFLUENT_API_KEY=your-cluster-api-key
CONFLUENT_API_SECRET=your-cluster-api-secret

# Optional: enables enriched cluster metadata via REST API
CONFLUENT_REST_ENDPOINT=https://pkc-abc12.eu-west-1.aws.confluent.cloud:443
CONFLUENT_CLUSTER_ID=lkc-abc123
```

## 4. Enable write operations (optional)

```env
KAFKA_ALLOW_WRITES=true
KAFKA_ALLOW_DESTRUCTIVE=true
```

## 5. Adding Schema Registry

Confluent Cloud includes a managed Schema Registry. The Schema Registry credentials are **different** from the Kafka cluster credentials.

Create a Schema Registry API key:
1. Go to Schema Registry in the Confluent Cloud console
2. Navigate to API credentials
3. Create a new key pair

```env
SCHEMA_REGISTRY_ENABLED=true
SCHEMA_REGISTRY_URL=https://psrc-abc12.eu-west-1.aws.confluent.cloud
SCHEMA_REGISTRY_API_KEY=your-schema-registry-api-key
SCHEMA_REGISTRY_API_SECRET=your-schema-registry-api-secret
```

This enables 8 additional tools for managing schemas (list, get, register, compatibility, config, delete).

## 6. Adding ksqlDB

If you have a ksqlDB cluster provisioned in Confluent Cloud:

1. Go to ksqlDB in the Confluent Cloud console
2. Note the API endpoint from the cluster settings
3. Create ksqlDB API credentials (or reuse cluster API key if permitted)

```env
KSQL_ENABLED=true
KSQL_ENDPOINT=https://pksqlc-abc12.eu-west-1.aws.confluent.cloud
KSQL_API_KEY=your-ksqldb-api-key
KSQL_API_SECRET=your-ksqldb-api-secret
```

This enables 7 additional tools for ksqlDB (streams, tables, queries, describe, run query, execute statement).

## 7. Start the server

```bash
bun run dev
```

Or build and run:

```bash
bun run build
bun run start
```

## 8. Integrate with Claude

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kafka": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/kafka-mcp-server/dist/index.js"],
      "env": {
        "KAFKA_PROVIDER": "confluent",
        "CONFLUENT_BOOTSTRAP_SERVERS": "pkc-abc12.eu-west-1.aws.confluent.cloud:9092",
        "CONFLUENT_API_KEY": "your-cluster-api-key",
        "CONFLUENT_API_SECRET": "your-cluster-api-secret",
        "KAFKA_ALLOW_WRITES": "true"
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
        "KAFKA_PROVIDER": "confluent",
        "CONFLUENT_BOOTSTRAP_SERVERS": "pkc-abc12.eu-west-1.aws.confluent.cloud:9092",
        "CONFLUENT_API_KEY": "your-cluster-api-key",
        "CONFLUENT_API_SECRET": "your-cluster-api-secret",
        "KAFKA_ALLOW_WRITES": "true"
      }
    }
  }
}
```

## Full .env example for Confluent Cloud

```env
# Provider
KAFKA_PROVIDER=confluent
CONFLUENT_BOOTSTRAP_SERVERS=pkc-abc12.eu-west-1.aws.confluent.cloud:9092
CONFLUENT_API_KEY=ABCDEFGHIJKLMNOP
CONFLUENT_API_SECRET=abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz01
CONFLUENT_REST_ENDPOINT=https://pkc-abc12.eu-west-1.aws.confluent.cloud:443
CONFLUENT_CLUSTER_ID=lkc-abc123

# Permissions
KAFKA_ALLOW_WRITES=true
KAFKA_ALLOW_DESTRUCTIVE=false

# Schema Registry
SCHEMA_REGISTRY_ENABLED=true
SCHEMA_REGISTRY_URL=https://psrc-abc12.eu-west-1.aws.confluent.cloud
SCHEMA_REGISTRY_API_KEY=QRSTUVWXYZ012345
SCHEMA_REGISTRY_API_SECRET=qrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdef01

# ksqlDB
KSQL_ENABLED=true
KSQL_ENDPOINT=https://pksqlc-abc12.eu-west-1.aws.confluent.cloud
KSQL_API_KEY=ABCDEFGHIJKLMNOP
KSQL_API_SECRET=abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz01

# Logging
LOG_LEVEL=info
```

## Troubleshooting

**Authentication failed**
- Verify your API key and secret are correct (no extra whitespace)
- Ensure the API key has the right ACLs for the operations you need
- Schema Registry and ksqlDB use separate API keys from the Kafka cluster

**Connection timeout**
- Check that the bootstrap server address is correct (include port 9092)
- Ensure your network allows outbound connections to Confluent Cloud

**Schema Registry returns 401/403**
- Schema Registry credentials are separate from cluster credentials
- Create a dedicated Schema Registry API key in the Confluent Cloud console

**ksqlDB returns 401/403**
- Verify your ksqlDB API credentials and endpoint URL
- Ensure the ksqlDB cluster is running and accessible
