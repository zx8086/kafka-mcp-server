// src/config/schemas.ts

import { z } from "zod";

export const kafkaSchema = z.object({
  provider: z
    .enum(["local", "msk", "confluent"])
    .describe("Kafka provider type"),
  clientId: z.string().describe("Kafka client identifier"),
  allowWrites: z
    .boolean()
    .describe("Whether write operations (produce, create topic) are permitted"),
  allowDestructive: z
    .boolean()
    .describe("Whether destructive operations (delete topic) are permitted"),
  consumeMaxMessages: z
    .number()
    .int()
    .positive()
    .describe("Maximum number of messages to consume per request"),
  consumeTimeoutMs: z
    .number()
    .int()
    .positive()
    .describe("Consume timeout in milliseconds"),
});

export const mskSchema = z.object({
  bootstrapBrokers: z
    .string()
    .describe("Comma-separated MSK bootstrap broker endpoints"),
  clusterArn: z.string().describe("MSK cluster ARN for IAM authentication"),
  region: z.string().describe("AWS region for MSK cluster"),
});

export const confluentSchema = z.object({
  bootstrapServers: z
    .string()
    .describe("Confluent Cloud bootstrap server endpoints"),
  apiKey: z.string().describe("Confluent Cloud API key"),
  apiSecret: z.string().describe("Confluent Cloud API secret"),
  restEndpoint: z.string().describe("Confluent Cloud REST API endpoint"),
  clusterId: z.string().describe("Confluent Cloud cluster identifier"),
});

export const localSchema = z.object({
  bootstrapServers: z
    .string()
    .describe("Local Kafka bootstrap server endpoints"),
});

export const loggingSchema = z.object({
  level: z
    .enum(["silent", "debug", "info", "warn", "error"])
    .describe("Log verbosity level"),
  backend: z.enum(["pino"]).describe("Logging backend to use"),
});

export const telemetrySchema = z.object({
  enabled: z.boolean().describe("Whether OpenTelemetry tracing is enabled"),
  serviceName: z
    .string()
    .describe("Service name reported in telemetry spans"),
  mode: z
    .enum(["console", "otlp", "both"])
    .describe("Telemetry export mode"),
  otlpEndpoint: z
    .string()
    .url()
    .describe("OTLP HTTP exporter endpoint"),
});

export const configSchema = z
  .object({
    kafka: kafkaSchema,
    msk: mskSchema,
    confluent: confluentSchema,
    local: localSchema,
    logging: loggingSchema,
    telemetry: telemetrySchema,
  })
  .superRefine((config, ctx) => {
    if (config.kafka.provider === "msk") {
      const hasBrokers = config.msk.bootstrapBrokers.length > 0;
      const hasArn = config.msk.clusterArn.length > 0;
      if (!hasBrokers && !hasArn) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["msk"],
          message:
            "MSK provider requires msk.bootstrapBrokers or msk.clusterArn to be set",
        });
      }
    }

    if (config.kafka.provider === "confluent") {
      if (config.confluent.bootstrapServers.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["confluent", "bootstrapServers"],
          message:
            "Confluent provider requires confluent.bootstrapServers to be set",
        });
      }
      if (config.confluent.apiKey.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["confluent", "apiKey"],
          message: "Confluent provider requires confluent.apiKey to be set",
        });
      }
      if (config.confluent.apiSecret.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["confluent", "apiSecret"],
          message: "Confluent provider requires confluent.apiSecret to be set",
        });
      }
    }
  });

export type AppConfig = z.infer<typeof configSchema>;
