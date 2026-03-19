// tests/tools/wrap.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AppConfig } from "../../src/config/schemas.ts";
import { wrapHandler } from "../../src/tools/wrap.ts";

function makeConfig(overrides: Partial<{
  allowWrites: boolean;
  allowDestructive: boolean;
  schemaRegistryEnabled: boolean;
  ksqlEnabled: boolean;
}>): AppConfig {
  return {
    kafka: {
      provider: "local",
      clientId: "test",
      allowWrites: overrides.allowWrites ?? false,
      allowDestructive: overrides.allowDestructive ?? false,
      consumeMaxMessages: 50,
      consumeTimeoutMs: 30000,
    },
    msk: { bootstrapBrokers: "", clusterArn: "", region: "eu-west-1" },
    confluent: {
      bootstrapServers: "",
      apiKey: "",
      apiSecret: "",
      restEndpoint: "",
      clusterId: "",
    },
    local: { bootstrapServers: "localhost:9092" },
    schemaRegistry: {
      enabled: overrides.schemaRegistryEnabled ?? false,
      url: "http://localhost:8081",
      apiKey: "",
      apiSecret: "",
    },
    ksql: {
      enabled: overrides.ksqlEnabled ?? false,
      endpoint: "http://localhost:8088",
      apiKey: "",
      apiSecret: "",
    },
    logging: { level: "silent", backend: "pino" },
    telemetry: {
      enabled: false,
      serviceName: "test",
      mode: "console",
      otlpEndpoint: "http://localhost:4318",
    },
  };
}

const successHandler = async () => ({
  content: [{ type: "text" as const, text: "ok" }],
});

describe("wrapHandler", () => {
  describe("feature gates", () => {
    test("blocks schema registry tools when disabled", async () => {
      const config = makeConfig({ schemaRegistryEnabled: false });
      const handler = wrapHandler("kafka_list_schemas", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Schema Registry is not enabled");
    });

    test("allows schema registry tools when enabled", async () => {
      const config = makeConfig({ schemaRegistryEnabled: true });
      const handler = wrapHandler("kafka_list_schemas", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBeUndefined();
    });

    test("blocks ksql tools when disabled", async () => {
      const config = makeConfig({ ksqlEnabled: false });
      const handler = wrapHandler("ksql_list_streams", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("ksqlDB is not enabled");
    });

    test("allows ksql tools when enabled", async () => {
      const config = makeConfig({ ksqlEnabled: true });
      const handler = wrapHandler("ksql_list_streams", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBeUndefined();
    });
  });

  describe("permission gates", () => {
    test("blocks write tools when writes disabled", async () => {
      const config = makeConfig({ allowWrites: false });
      const handler = wrapHandler("kafka_produce_message", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Write operations are disabled");
    });

    test("allows write tools when writes enabled", async () => {
      const config = makeConfig({ allowWrites: true });
      const handler = wrapHandler("kafka_produce_message", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBeUndefined();
    });

    test("blocks destructive tools when destructive disabled", async () => {
      const config = makeConfig({ allowDestructive: false });
      const handler = wrapHandler("kafka_delete_topic", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Destructive operations are disabled");
    });

    test("allows destructive tools when destructive enabled", async () => {
      const config = makeConfig({ allowDestructive: true });
      const handler = wrapHandler("kafka_delete_topic", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBeUndefined();
    });
  });

  describe("schema registry write/destructive permission gates", () => {
    test("blocks kafka_register_schema when schema enabled but writes disabled", async () => {
      const config = makeConfig({ schemaRegistryEnabled: true, allowWrites: false });
      const handler = wrapHandler("kafka_register_schema", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Write operations are disabled");
    });

    test("allows kafka_register_schema when schema enabled and writes enabled", async () => {
      const config = makeConfig({ schemaRegistryEnabled: true, allowWrites: true });
      const handler = wrapHandler("kafka_register_schema", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBeUndefined();
    });

    test("blocks kafka_delete_schema_subject when destructive disabled", async () => {
      const config = makeConfig({ schemaRegistryEnabled: true, allowDestructive: false });
      const handler = wrapHandler("kafka_delete_schema_subject", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Destructive operations are disabled");
    });

    test("allows kafka_delete_schema_subject when both enabled", async () => {
      const config = makeConfig({ schemaRegistryEnabled: true, allowDestructive: true });
      const handler = wrapHandler("kafka_delete_schema_subject", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBeUndefined();
    });
  });

  describe("ksql write permission gates", () => {
    test("blocks ksql_execute_statement when ksql enabled but writes disabled", async () => {
      const config = makeConfig({ ksqlEnabled: true, allowWrites: false });
      const handler = wrapHandler("ksql_execute_statement", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Write operations are disabled");
    });

    test("allows ksql_execute_statement when ksql and writes enabled", async () => {
      const config = makeConfig({ ksqlEnabled: true, allowWrites: true });
      const handler = wrapHandler("ksql_execute_statement", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBeUndefined();
    });
  });

  describe("feature gate takes precedence over permission gate", () => {
    test("schema registry feature gate fires before write gate", async () => {
      const config = makeConfig({ schemaRegistryEnabled: false, allowWrites: false });
      const handler = wrapHandler("kafka_register_schema", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Schema Registry is not enabled");
    });

    test("ksql feature gate fires before write gate", async () => {
      const config = makeConfig({ ksqlEnabled: false, allowWrites: false });
      const handler = wrapHandler("ksql_execute_statement", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("ksqlDB is not enabled");
    });
  });

  describe("read tools pass through", () => {
    test("kafka_list_topics always works", async () => {
      const config = makeConfig({});
      const handler = wrapHandler("kafka_list_topics", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBeUndefined();
    });

    test("kafka_describe_cluster always works", async () => {
      const config = makeConfig({});
      const handler = wrapHandler("kafka_describe_cluster", config, successHandler);
      const result = await handler({});
      expect(result.isError).toBeUndefined();
    });
  });
});
