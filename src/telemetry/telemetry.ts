// src/telemetry/telemetry.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from "@opentelemetry/sdk-trace-node";
import {
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} from "@opentelemetry/sdk-metrics";
import type { SpanExporter } from "@opentelemetry/sdk-trace-node";
import type { PushMetricExporter } from "@opentelemetry/sdk-metrics";

export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
  mode: "console" | "otlp" | "both";
  otlpEndpoint: string;
}

function buildExporters(config: TelemetryConfig): {
  spanProcessors: BatchSpanProcessor[];
  metricReaders: PeriodicExportingMetricReader[];
} {
  const spanExporters: SpanExporter[] = [];
  const metricExporters: PushMetricExporter[] = [];

  if (config.mode === "console" || config.mode === "both") {
    spanExporters.push(new ConsoleSpanExporter());
    metricExporters.push(new ConsoleMetricExporter());
  }

  if (config.mode === "otlp" || config.mode === "both") {
    spanExporters.push(
      new OTLPTraceExporter({ url: `${config.otlpEndpoint}/v1/traces` }),
    );
    metricExporters.push(
      new OTLPMetricExporter({ url: `${config.otlpEndpoint}/v1/metrics` }),
    );
  }

  return {
    spanProcessors: spanExporters.map(
      (exporter) => new BatchSpanProcessor(exporter),
    ),
    metricReaders: metricExporters.map(
      (exporter) => new PeriodicExportingMetricReader({ exporter }),
    ),
  };
}

export function initTelemetry(config: TelemetryConfig): NodeSDK | null {
  if (!config.enabled) {
    return null;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
  });

  const { spanProcessors, metricReaders } = buildExporters(config);

  const sdk = new NodeSDK({
    resource,
    spanProcessors,
    metricReaders,
  });

  sdk.start();

  return sdk;
}

export async function shutdownTelemetry(sdk: NodeSDK | null): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}
