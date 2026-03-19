# AWS MSK Setup Guide

Connect the Kafka MCP Server to an Amazon Managed Streaming for Apache Kafka (MSK) cluster using IAM authentication.

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- An AWS account with an MSK cluster (provisioned or serverless)
- Valid AWS credentials configured in the environment
- The `aws-msk-iam-sasl-signer-js` and `@aws-sdk/client-kafka` packages (included in project dependencies)

## How authentication works

The MSK provider uses **IAM OAUTHBEARER** authentication. It generates short-lived tokens via the AWS MSK IAM SASL Signer and automatically refreshes them 60 seconds before expiry. TLS is always enabled.

You do not provide a username/password -- instead, the server uses your AWS credentials (environment variables, shared credentials file, IAM role, etc.) to generate tokens.

## 1. Gather your MSK cluster details

You need at least one of:

| Value | Where to find it | Required |
|-------|-----------------|----------|
| Bootstrap brokers | MSK Console > Cluster > View client information > IAM auth endpoint | Either this or ARN |
| Cluster ARN | MSK Console > Cluster > Summary > ARN | Either this or brokers |
| AWS region | The region your cluster is deployed in | Yes |

If you only provide the cluster ARN, the server will automatically discover the bootstrap brokers using the AWS SDK.

## 2. Configure AWS credentials

The server needs AWS credentials with permissions to:

- Generate IAM auth tokens for MSK (`kafka-cluster:Connect`)
- Perform Kafka operations (`kafka-cluster:*` or scoped actions)
- Optionally describe the cluster (`kafka:DescribeClusterV2`, `kafka:GetBootstrapBrokers`)

### Option A: Environment variables

```bash
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
export AWS_REGION=eu-west-1
```

### Option B: AWS shared credentials file

Configure `~/.aws/credentials` and `~/.aws/config` as usual. The SDK picks them up automatically.

### Option C: IAM role (EC2, ECS, Lambda)

If running on AWS infrastructure, attach an IAM role with the necessary MSK permissions. No explicit credentials needed.

### Option D: AWS SSO / AWS profiles

```bash
export AWS_PROFILE=my-sso-profile
```

Run `aws sso login --profile my-sso-profile` first if using SSO.

## 3. Install dependencies

```bash
bun install
```

## 4. Create your .env file

```bash
cp .env.example .env
```

### Using bootstrap brokers (recommended if you know them)

```env
KAFKA_PROVIDER=msk
MSK_BOOTSTRAP_BROKERS=b-1.mycluster.abc123.c4.kafka.eu-west-1.amazonaws.com:9098,b-2.mycluster.abc123.c4.kafka.eu-west-1.amazonaws.com:9098
AWS_REGION=eu-west-1
```

Use the **IAM auth** endpoint (port 9098), not the plaintext endpoint.

### Using cluster ARN (auto-discovers brokers)

```env
KAFKA_PROVIDER=msk
MSK_CLUSTER_ARN=arn:aws:kafka:eu-west-1:123456789012:cluster/my-cluster/abc123-def456-ghi789
AWS_REGION=eu-west-1
```

The server calls `GetBootstrapBrokers` on startup to resolve the broker addresses. It prefers IAM SASL endpoints, falling back to public IAM SASL, then plaintext.

### Using both (ARN enables enriched cluster metadata)

```env
KAFKA_PROVIDER=msk
MSK_BOOTSTRAP_BROKERS=b-1.mycluster.abc123.c4.kafka.eu-west-1.amazonaws.com:9098
MSK_CLUSTER_ARN=arn:aws:kafka:eu-west-1:123456789012:cluster/my-cluster/abc123-def456-ghi789
AWS_REGION=eu-west-1
```

When both are provided, the brokers are used directly (no discovery call), and the ARN enables the `kafka_get_cluster_info` tool to return enriched AWS metadata via `DescribeClusterV2`.

## 5. Enable write operations (optional)

```env
KAFKA_ALLOW_WRITES=true
KAFKA_ALLOW_DESTRUCTIVE=true
```

## 6. Adding Schema Registry (optional)

If you run a Schema Registry alongside MSK (self-hosted or via Confluent):

```env
SCHEMA_REGISTRY_ENABLED=true
SCHEMA_REGISTRY_URL=http://your-schema-registry:8081
# SCHEMA_REGISTRY_API_KEY=     # if using basic auth
# SCHEMA_REGISTRY_API_SECRET=  # if using basic auth
```

## 7. Adding ksqlDB (optional)

If you run ksqlDB alongside MSK:

```env
KSQL_ENABLED=true
KSQL_ENDPOINT=http://your-ksqldb:8088
# KSQL_API_KEY=     # if using basic auth
# KSQL_API_SECRET=  # if using basic auth
```

## 8. Start the server

```bash
bun run dev
```

Or build and run:

```bash
bun run build
bun run start
```

## 9. Integrate with Claude

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kafka": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/kafka-mcp-server/dist/index.js"],
      "env": {
        "KAFKA_PROVIDER": "msk",
        "MSK_BOOTSTRAP_BROKERS": "b-1.mycluster.abc123.c4.kafka.eu-west-1.amazonaws.com:9098",
        "AWS_REGION": "eu-west-1",
        "AWS_PROFILE": "my-profile"
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
        "KAFKA_PROVIDER": "msk",
        "MSK_BOOTSTRAP_BROKERS": "b-1.mycluster.abc123.c4.kafka.eu-west-1.amazonaws.com:9098",
        "AWS_REGION": "eu-west-1",
        "AWS_PROFILE": "my-profile"
      }
    }
  }
}
```

Build first with `bun run build`.

## Full .env example for AWS MSK

```env
# Provider
KAFKA_PROVIDER=msk
MSK_BOOTSTRAP_BROKERS=b-1.mycluster.abc123.c4.kafka.eu-west-1.amazonaws.com:9098,b-2.mycluster.abc123.c4.kafka.eu-west-1.amazonaws.com:9098
MSK_CLUSTER_ARN=arn:aws:kafka:eu-west-1:123456789012:cluster/my-cluster/abc123-def456-ghi789
AWS_REGION=eu-west-1

# Permissions
KAFKA_ALLOW_WRITES=true
KAFKA_ALLOW_DESTRUCTIVE=false

# Schema Registry (self-hosted alongside MSK)
SCHEMA_REGISTRY_ENABLED=true
SCHEMA_REGISTRY_URL=http://schema-registry.internal:8081

# Logging
LOG_LEVEL=info
```

## IAM policy example

Minimum IAM policy for the MCP server (read-only):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "kafka-cluster:Connect",
        "kafka-cluster:DescribeCluster",
        "kafka-cluster:DescribeTopic",
        "kafka-cluster:ReadData",
        "kafka-cluster:DescribeGroup"
      ],
      "Resource": [
        "arn:aws:kafka:eu-west-1:123456789012:cluster/my-cluster/*",
        "arn:aws:kafka:eu-west-1:123456789012:topic/my-cluster/*",
        "arn:aws:kafka:eu-west-1:123456789012:group/my-cluster/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "kafka:DescribeClusterV2",
        "kafka:GetBootstrapBrokers"
      ],
      "Resource": "arn:aws:kafka:eu-west-1:123456789012:cluster/my-cluster/*"
    }
  ]
}
```

For write operations, add `kafka-cluster:WriteData`, `kafka-cluster:CreateTopic`, `kafka-cluster:AlterCluster`, `kafka-cluster:AlterTopic`.

For destructive operations, add `kafka-cluster:DeleteTopic`, `kafka-cluster:AlterGroup`.

## Troubleshooting

**"Failed to generate MSK IAM token"**
- AWS credentials are missing or invalid
- Run `aws sts get-caller-identity` to verify your credentials work
- If using SSO, run `aws sso login` first

**"No bootstrap brokers found for MSK cluster"**
- The cluster ARN is wrong or the cluster has no IAM-enabled endpoints
- Check MSK Console > Cluster > Properties > Security settings to confirm IAM auth is enabled

**Connection timeout**
- Ensure port 9098 (IAM auth) is open in your security groups
- If connecting from outside the VPC, you need public access enabled and the public IAM SASL endpoint
- Check that the VPC security group allows inbound on port 9098 from your IP

**"Access denied" on topic operations**
- Your IAM policy does not grant the required `kafka-cluster:*` actions
- Check the resource ARNs in your policy match your cluster, topics, and groups

**Token expiry errors**
- The server automatically refreshes tokens 60s before expiry, but if the clock is significantly skewed this can fail
- Ensure your system clock is synced (NTP)
