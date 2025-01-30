import {
  ExtendedPlugin,
  PluginContext,
  PluginMetadata,
  PluginAction
} from "../../services/plugins/types";
import { Message } from "../../types/message.types";
import { TwitterClient } from "./twitter.client";
import { TwitterInteractionControl } from "./interaction-control";
import debug from "debug";

const log = debug("arok:plugin:twitter-automation");

export interface AutomationConfig {
  enabled: boolean;
  schedule: string;
  maxRetries: number;
  timeout: number;
}

export abstract class TwitterAutomationPlugin implements ExtendedPlugin {
  protected context!: PluginContext;
  public client!: TwitterClient;
  public cache!: PluginContext["cacheService"];
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
  public interactionControl!: TwitterInteractionControl;

  abstract metadata: PluginMetadata;
  abstract actions: Record<string, PluginAction>;
  abstract config: AutomationConfig;

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    this.cache = context.cacheService;
    log(`Initializing ${this.metadata.name}`);
    this.client = TwitterClient.getInstance(context);
    this.interactionControl = new TwitterInteractionControl(
      this.metadata.name,
      this.context.cacheService,
      this.context.stateService
    );
  }

  async start() {
    if (this.config.enabled) {
      await this.startAutomation();
      log(`Started automation for ${this.metadata.name}`);
    }
  }

  protected async sendToTwitter(
    content: string,
    replyTo?: string,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    const twitterMessage: Message = {
      id: crypto.randomUUID(),
      content,
      author: "agent",
      createdAt: new Date().toISOString(),
      source: "twitter",
      requestId: replyTo,
      type: "event",
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
    return this.client.handleOutgoingMessage(twitterMessage);
  }

  protected async queryPlugin(
    prompt: string,
    context: Record<string, any> = {}
  ): Promise<any> {
    const queryMessage: Message = {
      id: crypto.randomUUID(),
      content: prompt,
      author: "agent",
      createdAt: new Date().toISOString(),
      source: "automated",
      type: "request",
      metadata: {
        type: "query",
        requiresProcessing: true,
        context
      }
    };

    log(`Querying with prompt: ${prompt}`);

    const responseMessage =
      await this.context.agentService.handleMessage(queryMessage);

    try {
      return JSON.parse(responseMessage.content);
    } catch {
      return responseMessage.content;
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
