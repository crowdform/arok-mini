import {
  ExtendedPlugin,
  PluginContext,
  PluginMetadata,
  PluginAction
} from "../../services/plugins/types";
import { Message } from "../../types/message.types";
import debug from "debug";

const log = debug("arok:plugin:twitter-automation");

export interface AutomationConfig {
  enabled: boolean;
  interval: number;
  maxRetries: number;
  timeout: number;
}

export abstract class TwitterAutomationPlugin implements ExtendedPlugin {
  protected context!: PluginContext;
  protected intervals: NodeJS.Timeout[] = [];
  protected messageHandlers: Map<string, (message: Message) => Promise<void>> =
    new Map();
  protected retryCount: Map<string, number> = new Map();
  protected responsePromises: Map<
    string,
    {
      resolve: (value: Message) => void;
      reject: (reason?: any) => void;
    }
  > = new Map();

  abstract metadata: PluginMetadata;
  abstract actions: Record<string, PluginAction>;
  abstract config: AutomationConfig;

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    log(`Initializing ${this.metadata.name}`);

    this.context.messageBus.subscribeToOutgoing(
      this.handleAgentResponse.bind(this)
    );
  }

  async start() {
    if (this.config.enabled) {
      await this.startAutomation();
      log(`Started automation for ${this.metadata.name}`);
    }
  }

  protected async handleAgentResponse(message: Message) {
    if (!message.parentId) return;

    const promiseHandler = this.responsePromises.get(message.parentId);
    if (promiseHandler) {
      promiseHandler.resolve(message);
      this.responsePromises.delete(message.parentId);
      return;
    }

    const handler = this.messageHandlers.get(message.parentId);
    if (handler) {
      try {
        await handler(message);
        this.messageHandlers.delete(message.parentId);
        this.retryCount.delete(message.parentId);
      } catch (error) {
        const retries = (this.retryCount.get(message.parentId) || 0) + 1;
        if (retries <= this.config.maxRetries) {
          this.retryCount.set(message.parentId, retries);
          log(
            `Retrying handler for message ${message.parentId}, attempt ${retries}`
          );
          await handler(message);
        } else {
          console.error(`Max retries exceeded for message ${message.parentId}`);
          this.messageHandlers.delete(message.parentId);
          this.retryCount.delete(message.parentId);
        }
      }
    }
  }

  protected async waitForAgentResponse(
    messageId: string,
    timeout?: number
  ): Promise<Message> {
    return new Promise((resolve, reject) => {
      const timeoutMs = timeout || this.config.timeout;
      const timeoutId = setTimeout(() => {
        this.responsePromises.delete(messageId);
        reject(new Error(`Timeout waiting for agent response to ${messageId}`));
      }, timeoutMs);

      this.responsePromises.set(messageId, {
        resolve: (message: Message) => {
          clearTimeout(timeoutId);
          resolve(message);
        },
        reject
      });
    });
  }

  protected async sendToTwitter(
    content: string,
    replyTo?: string,
    metadata: Record<string, any> = {}
  ) {
    const twitterMessage: Message = {
      id: crypto.randomUUID(),
      content,
      author: "system",
      createdAt: new Date().toISOString(),
      source: "twitter",
      parentId: replyTo,
      metadata: {
        isTwitterContent: true,
        automated: true,
        requiresPosting: true,
        pluginName: this.metadata.name,
        timestamp: Date.now(),
        ...metadata
      }
    };

    log(`Sending content to Twitter: ${content.substring(0, 50)}...`);
    await this.context.messageBus.send(twitterMessage);
  }

  protected async queryPlugin(
    prompt: string,
    context: Record<string, any> = {}
  ): Promise<any> {
    const queryMessage: Message = {
      id: crypto.randomUUID(),
      content: prompt,
      author: "system",
      createdAt: new Date().toISOString(),
      source: "automated",
      metadata: {
        type: "query",
        requiresProcessing: true,
        context
      }
    };

    log(`Querying with prompt: ${prompt}`);
    await this.context.messageBus.publish(queryMessage);
    const response = await this.waitForAgentResponse(queryMessage.id);

    try {
      return JSON.parse(response.content);
    } catch {
      return response.content;
    }
  }

  protected abstract startAutomation(): Promise<void>;

  protected async cleanupIntervals() {
    this.intervals.forEach(clearInterval);
    this.intervals = [];
    log(`Cleaned up intervals for ${this.metadata.name}`);
  }

  public async shutdown(): Promise<void> {
    await this.cleanupIntervals();
    this.messageHandlers.clear();
    this.retryCount.clear();
    this.responsePromises.clear();
    log(`Shut down ${this.metadata.name}`);
  }
}
