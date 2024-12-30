// src/services/agent.service.ts

import { LLMService } from "./llm.service";
import { MemoryService } from "./memory.service";
import { MessageService } from "./message.service";
import { Message } from "../types/message.types";
import { PluginManager } from "./plugins/plugin.manager";
import { Plugin, ExtendedPlugin } from "./plugins/types";
import { RateLimitService } from "./rate-limit.service";
import { StateService } from "./state.service";
import debug from "debug";
import { Character } from "./character.loader";
import type { OpenAI } from "openai";
import { CacheService } from "./cache.service";

const log = debug("arok:agent-service");

export interface AgentConfig {
  characterConfig: Character;
  llmInstance: OpenAI;
  llmInstanceModel: string;
}

export class AgentService {
  private readonly llm: LLMService;
  private readonly memory: MemoryService;
  private readonly _messageBus: MessageService;
  private readonly pluginManager: PluginManager;
  private readonly rateLimit: RateLimitService;
  private isShuttingDown: boolean = false;
  private isStarted: boolean = false;
  private readonly MAX_PLUGIN_DEPTH = 3;

  constructor(config: AgentConfig) {
    this.memory = new MemoryService();
    const stateService = new StateService(config.characterConfig, this.memory);
    this.llm = new LLMService({
      llmInstance: config.llmInstance,
      llmInstanceModel: config.llmInstanceModel,
      stateService
    });
    this.rateLimit = new RateLimitService();
    this._messageBus = new MessageService();

    this.pluginManager = new PluginManager({
      messageBus: this._messageBus,
      memoryService: this.memory,
      llmService: this.llm,
      stateService: stateService,
      cacheService: new CacheService()
    });

    this._messageBus.subscribe(this.handleMessage.bind(this));
  }

  get messageBus(): MessageService {
    return this._messageBus;
  }

  async registerPlugin(plugin: Plugin | ExtendedPlugin): Promise<void> {
    try {
      if (this.isStarted) {
        throw new Error("Cannot register plugins after agent has been started");
      }
      await this.pluginManager.registerPlugin(plugin);
      log(`Plugin ${plugin.metadata.name} registered successfully`);
    } catch (error) {
      console.error(
        `Failed to register plugin ${plugin.metadata.name}:`,
        error
      );
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error("Agent has already been started");
    }

    try {
      log("Starting agent service...");

      // Start all registered plugins that have a start method
      const plugins = this.pluginManager.getRegisteredPlugins();
      for (const plugin of plugins) {
        if ("start" in plugin && typeof plugin.start === "function") {
          log(`Starting plugin: ${plugin.metadata.name}`);
          await plugin.start();
        }
      }

      this.isStarted = true;
      log("Agent service started successfully");
    } catch (error) {
      console.error("Failed to start agent service:", error);
      throw error;
    }
  }

  // @ts-ignore
  private async handleMessage(
    message: Message,
    pluginDepth = 0,
    pluginResponses: Record<string, any>[] = []
  ) {
    if (this.isShuttingDown) {
      log("Agent is shutting down, message rejected:", message.id);
      return;
    }

    try {
      // Always store the message for context
      await this.memory.addMemory(message);

      // Check rate limit before processing
      const canProcess = await this.rateLimit.checkRateLimit(
        message.author,
        message.id
      );

      if (!canProcess) {
        log("Rate limit exceeded for user:", message.author);
        // Send NO_RESPONSE notification
        await this.sendResponse(message, {
          content: "NO_RESPONSE",
          metadata: {
            type: "rate_limit",
            reason:
              "Message limit exceeded. Please wait before sending more messages."
          }
        });
        return;
      }

      const history = await this.memory.getRecentContext(message.author, 5);
      const pluginMetadata = this.pluginManager.getPluginMetadata();

      log("Processing message with plugin depth:", pluginDepth);
      const result = await this.llm.processMessage(
        message,
        history,
        pluginMetadata,
        pluginResponses
      );

      // Check for NO_RESPONSE
      if (result.content === "NO_RESPONSE" || result.action === "NO_RESPONSE") {
        log("AI chose NO_RESPONSE");
        await this.sendResponse(message, {
          content: "NO_RESPONSE",
          metadata: {
            type: "no_response",
            reason: result.metadata?.reason || "Agent chose not to respond",
            timestamp: Date.now()
          }
        });
        return;
      }

      if (result.action && pluginDepth < this.MAX_PLUGIN_DEPTH) {
        log(`Executing plugin action: ${result.action}`);
        try {
          const pluginResult = await this.executePluginWithTimeout(
            result.action,
            message,
            result.data
          );

          pluginResponses.push({
            action: result.action,
            result: pluginResult,
            timestamp: Date.now()
          });

          return this.handleMessage(message, pluginDepth + 1, pluginResponses);
        } catch (error) {
          console.error("Plugin execution error:", error);
          await this.sendResponse(message, {
            content: "NO_RESPONSE",
            metadata: {
              error: true,
              reason: "Error processing plugin action"
            }
          });
        }
      } else {
        await this.sendResponse(message, result);
      }
    } catch (error) {
      console.error("Error handling message:", error);
      await this.handleError(
        message,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private async executePluginWithTimeout(
    action: string,
    message: Message,
    data: any
  ): Promise<any> {
    const timeout = 30000; // 30 seconds
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Plugin execution timed out"));
      }, timeout);

      this.pluginManager
        .handleIntent(action, message, data)
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(reject);
    });
  }

  private async sendResponse(
    message: Message,
    result: { content: string; metadata?: any }
  ) {
    const response: Message = {
      id: crypto.randomUUID(),
      content: result.content,
      author: "agent",
      participants: [message.author],
      source: message.source,
      parentId: message.id,
      createdAt: new Date().toISOString(),
      metadata: {
        ...message.metadata,
        ...result.metadata,
        isResponse: true
      }
    };

    log("Sending response:", response);
    await this.memory.addMemory(response);
    await this._messageBus.send(response);
  }

  private async handleError(message: Message, error: Error) {
    const errorResponse: Message = {
      id: crypto.randomUUID(),
      content:
        "I encountered an error processing your request. Please try again.",
      author: "agent",
      participants: [message.author],

      source: message.source,
      createdAt: new Date().toISOString(),
      parentId: message.id,
      metadata: {
        error: error.message,
        isError: true
      }
    };

    log("Sending error response:", errorResponse);
    await this.memory.addMemory(errorResponse);
    await this._messageBus.send(errorResponse);
  }

  async shutdown(): Promise<void> {
    log("Starting graceful shutdown of agent service...");
    this.isShuttingDown = true;

    // Shutdown all plugins that have a shutdown method
    const plugins = this.pluginManager.getRegisteredPlugins();
    for (const plugin of plugins) {
      if ("shutdown" in plugin && typeof plugin.shutdown === "function") {
        try {
          await plugin.shutdown();
        } catch (error) {
          console.error(
            `Error shutting down plugin ${plugin.metadata.name}:`,
            error
          );
        }
      }
    }

    this._messageBus.clearSubscriptions();
    this.isStarted = false;
    log("Agent service shut down successfully");
  }
}
