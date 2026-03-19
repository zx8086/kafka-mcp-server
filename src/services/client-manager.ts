// src/services/client-manager.ts
import { Admin } from "@platformatic/kafka";
import { Producer } from "@platformatic/kafka";
import { Consumer } from "@platformatic/kafka";
import type { KafkaProvider, KafkaConnectionConfig } from "../providers/types.ts";

export class KafkaClientManager {
  private admin: Admin | null = null;
  private producer: Producer | null = null;
  private cachedConfig: KafkaConnectionConfig | null = null;

  constructor(private readonly provider: KafkaProvider) {}

  async getAdmin(): Promise<Admin> {
    if (this.admin && !this.admin.closed) {
      return this.admin;
    }
    const config = await this.getConnectionConfig();
    this.admin = new Admin({
      clientId: config.clientId,
      bootstrapBrokers: config.bootstrapBrokers,
      sasl: config.sasl,
      tls: config.tls,
      connectTimeout: config.connectTimeout,
      requestTimeout: config.requestTimeout,
      retries: config.retries,
      retryDelay: config.retryDelay,
    });
    return this.admin;
  }

  async getProducer(): Promise<Producer> {
    if (this.producer && !this.producer.closed) {
      return this.producer;
    }
    const config = await this.getConnectionConfig();
    this.producer = new Producer({
      clientId: config.clientId,
      bootstrapBrokers: config.bootstrapBrokers,
      sasl: config.sasl,
      tls: config.tls,
      connectTimeout: config.connectTimeout,
      requestTimeout: config.requestTimeout,
      retries: config.retries,
      retryDelay: config.retryDelay,
    });
    return this.producer;
  }

  async createConsumer(groupId: string): Promise<Consumer> {
    const config = await this.getConnectionConfig();
    return new Consumer({
      clientId: config.clientId,
      bootstrapBrokers: config.bootstrapBrokers,
      sasl: config.sasl,
      tls: config.tls,
      connectTimeout: config.connectTimeout,
      requestTimeout: config.requestTimeout,
      retries: config.retries,
      retryDelay: config.retryDelay,
      groupId,
    });
  }

  getProvider(): KafkaProvider {
    return this.provider;
  }

  async close(): Promise<void> {
    const closeOps: Promise<void>[] = [];

    if (this.admin && !this.admin.closed) {
      closeOps.push(this.admin.close());
    }
    if (this.producer && !this.producer.closed) {
      closeOps.push(this.producer.close());
    }

    await Promise.allSettled(closeOps);
    await this.provider.close();

    this.admin = null;
    this.producer = null;
    this.cachedConfig = null;
  }

  private async getConnectionConfig(): Promise<KafkaConnectionConfig> {
    if (!this.cachedConfig) {
      this.cachedConfig = await this.provider.getConnectionConfig();
    }
    return this.cachedConfig;
  }
}
