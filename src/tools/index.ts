// src/tools/index.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config/schemas.ts";
import type { KafkaService } from "../services/kafka-service.ts";
import { registerDestructiveTools } from "./destructive/tools.ts";
import { registerReadTools } from "./read/tools.ts";
import { registerWriteTools } from "./write/tools.ts";

export function registerAllTools(
  server: McpServer,
  service: KafkaService,
  config: AppConfig,
): void {
  registerReadTools(server, service, config);
  registerWriteTools(server, service);
  registerDestructiveTools(server, service);
}
