// src/tools/wrap.ts
import type { AppConfig } from "../config/schemas.ts";
import { normalizeError } from "../lib/errors.ts";
import { ResponseBuilder } from "../lib/response-builder.ts";
import { getLogger } from "../logging/container.ts";
import { traceToolExecution } from "../telemetry/tracing.ts";

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const WRITE_TOOLS = new Set([
  "kafka_produce_message",
  "kafka_create_topic",
  "kafka_alter_topic_config",
]);

const DESTRUCTIVE_TOOLS = new Set(["kafka_delete_topic", "kafka_reset_consumer_group_offsets"]);

export function wrapHandler<T>(
  toolName: string,
  config: AppConfig,
  handler: (args: T) => Promise<ToolResponse>,
): (args: T) => Promise<ToolResponse> {
  return async (args: T) => {
    const logger = getLogger();

    if (WRITE_TOOLS.has(toolName) && !config.kafka.allowWrites) {
      return ResponseBuilder.error(
        "Write operations are disabled. Set KAFKA_ALLOW_WRITES=true to enable.",
      );
    }
    if (DESTRUCTIVE_TOOLS.has(toolName) && !config.kafka.allowDestructive) {
      return ResponseBuilder.error(
        "Destructive operations are disabled. Set KAFKA_ALLOW_DESTRUCTIVE=true to enable.",
      );
    }

    return traceToolExecution(toolName, async () => {
      try {
        logger.debug(`Executing tool: ${toolName}`);
        const result = await handler(args);
        logger.debug(`Tool completed: ${toolName}`);
        return result;
      } catch (error) {
        logger.error(`Tool failed: ${toolName}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        const mcpError = normalizeError(error);
        return ResponseBuilder.error(mcpError.message);
      }
    });
  };
}
