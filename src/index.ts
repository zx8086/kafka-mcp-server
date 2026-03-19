// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { NodeSDK } from "@opentelemetry/sdk-node";
import { getConfig } from "./config/index.ts";
import { getLogger, setLogger } from "./logging/container.ts";
import { createLogger } from "./logging/create-logger.ts";
import { createProvider } from "./providers/factory.ts";
import { KafkaClientManager } from "./services/client-manager.ts";
import { KafkaService } from "./services/kafka-service.ts";
import { initTelemetry, shutdownTelemetry } from "./telemetry/telemetry.ts";
import { registerAllTools } from "./tools/index.ts";

async function main(): Promise<void> {
  // 1. Load config
  const config = getConfig();

  // 2. Create logger
  const logger = createLogger({
    level: config.logging.level,
    name: config.telemetry.serviceName,
    isDev: config.kafka.provider === "local",
  });
  setLogger(logger);
  logger.info("Starting Kafka MCP Server", {
    provider: config.kafka.provider,
    clientId: config.kafka.clientId,
  });

  // 3. Init telemetry
  let sdk: NodeSDK | null = null;
  if (config.telemetry.enabled) {
    sdk = initTelemetry(config.telemetry);
    logger.info("Telemetry initialized", { mode: config.telemetry.mode });
  }

  // 4. Create provider
  const provider = createProvider(config);
  logger.info(`Provider created: ${provider.name}`);

  // 5. Create client manager and service
  const clientManager = new KafkaClientManager(provider);
  const kafkaService = new KafkaService(clientManager);

  // 6. Create MCP server
  const server = new McpServer({
    name: "kafka-mcp-server",
    version: "1.0.0",
  });

  // 7. Register all tools (with universal wrapping)
  registerAllTools(server, kafkaService, config);
  logger.info("All tools registered");

  // 8. Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP server connected via stdio");

  // 9. Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);

    try {
      await clientManager.close();
      logger.info("Kafka clients closed");
    } catch (error) {
      logger.error("Error closing Kafka clients", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await shutdownTelemetry(sdk);
    } catch (error) {
      logger.error("Error shutting down telemetry", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.flush();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  const logger = getLogger();
  logger.error("Fatal error starting server", {
    error: error instanceof Error ? error.message : String(error),
  });
  logger.flush();
  process.exit(1);
});
