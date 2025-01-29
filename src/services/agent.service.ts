// src/services/agent.service.ts

import { LLMService } from "./llm.service";
import { MemoryService } from "./memory.service";
import { MessageService } from "./message.service";
import { Message, ROUTING_PATTERNS } from "../types/message.types";
import { PluginManager } from "./plugins/plugin.manager";
import { Plugin, ExtendedPlugin, PluginMetadata } from "./plugins/types";
import { RateLimitService } from "./rate-limit.service";
import { StateService } from "./state.service";
import debug from "debug";
import { Character } from "./character.loader";
import { CacheService } from "./cache.service";
import { SchedulerService } from "./scheduler/scheduler.service";
import type { SchedulerConfig } from "./scheduler/types";
import { generateText, tool, jsonSchema } from "ai";
import type { OpenAIProvider } from "@ai-sdk/openai";
import { AIResponseParser } from "../utils";
const log = debug("arok:agent-service");
import { z } from "zod";

export interface AgentConfig {
  characterConfig: Character;
  llmInstance: OpenAIProvider;
  llmInstanceModel: string;
  schedulerConfig?: SchedulerConfig;
}

// Schema for agent responses

export class AgentService {
  private readonly llm: LLMService;
  private readonly memory: MemoryService;
  private readonly _messageBus: MessageService;
  private readonly pluginManager: PluginManager;
  private readonly rateLimit: RateLimitService;
  private isShuttingDown: boolean = false;
  private isStarted: boolean = false;
  private readonly MAX_STEPS = 10; // Maximum number of iterations
  private readonly scheduler: SchedulerService;
  private readonly cacheService: CacheService;
  private readonly stateService: StateService;
  private readonly llmInstance: OpenAIProvider;
  private tools: Record<string, any> = {};
  public responseParser: typeof AIResponseParser;

  constructor(config: AgentConfig) {
    this.memory = new MemoryService();
    this.stateService = new StateService(config.characterConfig, this.memory);
    this.llm = new LLMService({
      llmInstanceModel: config.llmInstanceModel,
      stateService: this.stateService,
      llmInstance: config.llmInstance
    });
    this.llmInstance = config.llmInstance;
    this.rateLimit = new RateLimitService();
    this._messageBus = new MessageService();
    this.cacheService = new CacheService();
    this.scheduler = new SchedulerService(
      config.schedulerConfig || {
        mode: "single-node",
        timeZone: "UTC",
        heartbeatInterval: 60000
      },
      this.cacheService
    );

    this.responseParser = AIResponseParser;

    const context = {
      messageBus: this._messageBus,
      memoryService: this.memory,
      cacheService: this.cacheService,
      stateService: this.stateService,
      llmService: this.llm,
      schedulerService: this.scheduler,
      agentService: this
    };

    this.pluginManager = new PluginManager(context);
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
      if (plugins.length > 0) {
        for (const plugin of plugins) {
          if ("start" in plugin && typeof plugin.start === "function") {
            log(`Starting plugin: ${plugin.metadata.name}`);
            await plugin.start();
          }
        }
      }
      // Convert plugins to tools format

      this.isStarted = true;
      this.scheduler.initialize();
      log("Agent service started successfully");
    } catch (error) {
      console.error("Failed to start agent service:", error);
      throw error;
    }
  }

  private convertPluginsToTools(
    plugins: (ExtendedPlugin | Plugin)[],
    scope: string[] = ["*"]
  ): Record<string, any> {
    const tools: Record<string, any> = {};

    for (const plugin of plugins) {
      for (const [actionName, actionMeta] of Object.entries(
        plugin.metadata.actions
      )) {
        // Skip if no scope defined
        if (!actionMeta?.scope) {
          continue;
        }

        // Check if either array contains '*' or if there's any intersection
        const hasWildcard =
          scope.includes("*") || actionMeta.scope.includes("*");
        // @ts-ignore
        const hasIntersection = scope.some((s) => actionMeta.scope.includes(s));

        if (hasWildcard || hasIntersection) {
          tools[actionName] = tool({
            description: actionMeta.description,
            parameters:
              actionMeta.schema instanceof z.ZodType
                ? actionMeta.schema
                : // @ts-ignore
                  jsonSchema(actionMeta.schema),
            execute: async (params: any) => {
              try {
                log(`Executing tool ${actionName} with params:`, params);
                const result = await (plugin as any).actions[
                  actionName
                ].execute(params);
                return result;
              } catch (error) {
                console.error(`Error executing tool ${actionName}:`, error);
                throw error;
              }
            }
          });
        }
      }
    }

    return tools;
  }

  public async handleMessage(
    message: Message,
    config: { postSystemPrompt?: string; pluginScope?: string[] } = {}
  ): Promise<Message> {
    if (this.isShuttingDown) {
      log("Agent is shutting down, message rejected:", message.id);
      return this.sendResponse(message, {
        content: "Rate limit exceeded. Please try again later."
      });
    }

    try {
      // Store the initial message
      await this.memory.addMemory(message);

      // Check rate limit before processing
      const canProcess = await this.rateLimit.checkRateLimit(
        message.author,
        message.id
      );
      if (!canProcess) {
        return this.sendResponse(message, {
          content: "Rate limit exceeded. Please try again later.",
          metadata: {
            type: "rate_limit",
            reason:
              "Message limit exceeded. Please wait before sending more messages.",
            timestamp: Date.now()
          }
        });
      }

      const plugins = this.pluginManager.getRegisteredPlugins();
      const availableTools =
        plugins.length > 0
          ? this.convertPluginsToTools(plugins, config?.pluginScope || ["*"])
          : undefined;

      // Get conversation context
      const history = await this.memory.getRecentContext(message.author, 5);

      const state = await this.stateService.composeState(
        message,
        history,
        this.pluginManager.getRegisteredPlugins().map((p) => p.metadata)
      );

      log(
        "Available tools: ",
        availableTools ? Object.keys(availableTools) : "None"
      );

      // Process with Vercel AI SDK Runtime
      // @ts-ignore
      const {
        text: answer,
        usage,
        steps
      } = await generateText({
        headers: {
          "Helicone-Session-Id": message.id,
          "Helicone-Session-Path": `/Users/${message.author}`,
          "Helicone-Session-Name": message.source
        },
        // @ts-ignore
        model: this.llmInstance(this.llm.llmInstanceModel),
        system:
          this.stateService.buildSystemPrompt(state) + config?.postSystemPrompt,
        messages: [
          // @ts-ignore
          ...this.stateService.buildHistoryContext(state).reverse(),
          // @ts-ignore
          { role: "user", content: message.content }
        ],
        maxSteps: this.MAX_STEPS,
        tools: availableTools,
        // experimental_continueSteps: true,
        // experimental_streamTools: true,
        onStepFinish: async ({
          // @ts-ignore
          text,
          // @ts-ignore
          toolCalls,
          // @ts-ignore
          toolResults,
          // @ts-ignore
          usage,
          // @ts-ignore
          finishReason
          // @ts-ignore
        }) => {
          log(toolResults);

          const formatToolResult = (toolResults: any) => {
            const firstResult = toolResults?.[0];

            if (!firstResult) {
              return "";
            }

            const { toolName, result } = firstResult;

            return `Plugin called ${toolName} with result: ${JSON.stringify(result)}`;
          };
          // Save conversation history
          await this.memory.addMemory({
            ...message,
            id: crypto.randomUUID(),
            content: text || formatToolResult(toolResults),
            chainId: message.id,
            metadata: {
              usage,
              toolResults
            }
          });
        }
      });

      return this.sendResponse(message, {
        content: answer,
        metadata: {
          usage,
          steps
        }
      });
    } catch (error) {
      console.error("Error in handleMessage:", error);

      // Generate error response using schema

      return this.handleError(
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
  ): Promise<Message> {
    const response: Message = {
      id: crypto.randomUUID(),
      content: result.content,
      author: "agent",
      participants: message.participants,
      source: message.source,
      type: "response",
      chainId: message.id,
      requestId: message.id,
      createdAt: new Date().toISOString(),
      metadata: {
        ...message.metadata,
        ...result.metadata,
        isResponse: true
      }
    };

    return response;
  }

  private async handleError(message: Message, error: Error): Promise<Message> {
    const errorResponse: Message = {
      id: crypto.randomUUID(),
      content:
        "I encountered an error processing your request. Please try again.",
      author: "agent",
      participants: [message.author],
      type: "event",
      chainId: message.id,
      source: message.source,
      createdAt: new Date().toISOString(),
      requestId: message.id,
      metadata: {
        error: error.message,
        isError: true
      }
    };

    return errorResponse;
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

    this._messageBus.clear();
    this.isStarted = false;
    log("Agent service shut down successfully");
  }
}
