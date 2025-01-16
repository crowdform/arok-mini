// src/services/agent.service.ts

import { LLMService } from "./llm.service";
import { MemoryService } from "./memory.service";
import { MessageService } from "./message.service";
import { Message } from "../types/message.types";
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

const log = debug("arok:agent-service");

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

    const context = {
      messageBus: this._messageBus,
      memoryService: this.memory,
      cacheService: this.cacheService,
      stateService: this.stateService,
      llmService: this.llm,
      schedulerService: this.scheduler
    };

    this.pluginManager = new PluginManager(context);

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

      // Convert plugins to tools format
      // @ts-ignore
      this.tools = this.convertPluginsToTools(plugins);

      this.isStarted = true;
      this.scheduler.initialize();
      log("Agent service started successfully");
    } catch (error) {
      console.error("Failed to start agent service:", error);
      throw error;
    }
  }

  private convertPluginsToTools(plugins: Plugin[]): Record<string, any> {
    const tools: Record<string, any> = {};

    for (const plugin of plugins) {
      for (const [actionName, actionMeta] of Object.entries(
        plugin.metadata.actions
      )) {
        // Only include scoped actions
        if (!actionMeta?.scope || !actionMeta?.scope.includes("*")) {
          log(`Skipping action ${actionName} due to scope restrictions`);
          continue;
        }

        log(`Plugin-${actionName}`, (plugin as any).actions);
        tools[actionName] = tool({
          // Convert Zod schema to parameters object
          // @ts-ignore
          parameters: jsonSchema(actionMeta.schema),
          // Wrapper function to handle tool execution
          execute: async (params: any) => {
            try {
              log(`Executing tool ${actionName} with params:`, params);
              const result = await (plugin as any).actions[actionName].execute(
                params
              );
              return result;
            } catch (error) {
              console.error(`Error executing tool ${actionName}:`, error);
              throw error;
            }
          }
        });
      }
    }

    return tools;
  }

  private async handleMessage(message: Message): Promise<void> {
    if (this.isShuttingDown) {
      log("Agent is shutting down, message rejected:", message.id);
      return;
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
        await this.sendResponse(message, {
          content: "Rate limit exceeded. Please try again later.",
          metadata: {
            type: "rate_limit",
            reason:
              "Message limit exceeded. Please wait before sending more messages.",
            timestamp: Date.now()
          }
        });
        return;
      }

      // Get conversation context
      const history = await this.memory.getRecentContext(message.author, 5);

      const state = await this.stateService.composeState(message, history);
      const tools = this.tools;

      log("Available tools:", Object.keys(tools));

      // Process with Vercel AI SDK Runtime
      // @ts-ignore
      const {
        text: answer,
        usage,
        steps
      } = await generateText({
        // @ts-ignore
        model: this.llmInstance(this.llm.llmInstanceModel),
        system: this.stateService.buildSystemPrompt(state),
        messages: [
          // @ts-ignore
          ...this.stateService.buildHistoryContext(state).reverse(),
          // @ts-ignore
          { role: "user", content: message.content }
        ],
        maxSteps: this.MAX_STEPS,
        tools,
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
          // Save conversation history
          await this.memory.addMemory({
            ...message,
            id: crypto.randomUUID(),
            content: text,
            metadata: {
              usage,
              toolResults
            }
          });
        }
      });

      // // Send final response
      await this.sendResponse(message, {
        content: answer,

        metadata: {
          steps,
          usage
        }
      });
    } catch (error) {
      console.error("Error in handleMessage:", error);

      // Generate error response using schema

      await this.handleError(
        message,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // private async saveMessageToHistory(result: {
  //   originalMessage: Message;
  //   text: string;
  //   toolCalls?: Array<{
  //     name: string;
  //     args: Record<string, any>;
  //   }>;
  //   toolResults?: Array<any>;
  //   usage?: {
  //     promptTokens: number;
  //     completionTokens: number;
  //     totalTokens: number;
  //   };
  //   finishReason?: string;
  //   stepCount?: number;
  // }): Promise<void> {
  //   const timestamp = Date.now();

  //   try {
  //     // Save original user message if not already saved
  //     if (
  //       originalMessage.author !== "agent" &&
  //       originalMessage.author !== "system"
  //     ) {
  //       await this.memory.addMemory({
  //         ...originalMessage,
  //         metadata: {
  //           ...originalMessage.metadata,
  //           timestamp,
  //           messageType: "user"
  //         }
  //       });
  //     }

  //     // If there were tool calls, save them and their results
  //     if (result.toolCalls?.length) {
  //       for (let i = 0; i < result.toolCalls.length; i++) {
  //         const toolCall = result.toolCalls[i];
  //         const toolResult = result.toolResults?.[i];

  //         // Save tool call
  //         await this.memory.addMemory({
  //           id: crypto.randomUUID(),
  //           content: JSON.stringify(toolCall.args),
  //           author: "system",
  //           createdAt: new Date().toISOString(),
  //           source: "plugin",
  //           parentId: originalMessage.id,
  //           metadata: {
  //             messageType: "tool_call",
  //             toolName: toolCall.name,
  //             stepIndex: i,
  //             timestamp,
  //             usage: result.usage
  //           }
  //         });

  //         // Save tool result
  //         await this.memory.addMemory({
  //           id: crypto.randomUUID(),
  //           content: JSON.stringify(toolResult),
  //           author: "system",
  //           createdAt: new Date().toISOString(),
  //           source: "plugin",
  //           parentId: originalMessage.id,
  //           metadata: {
  //             messageType: "tool_result",
  //             toolName: toolCall.name,
  //             stepIndex: i,
  //             timestamp,
  //             usage: result.usage
  //           }
  //         });
  //       }
  //     }

  //     // Save the final AI response
  //     await this.memory.addMemory({
  //       id: crypto.randomUUID(),
  //       content: result.text,
  //       author: "agent",
  //       createdAt: new Date().toISOString(),
  //       source: originalMessage.source,
  //       parentId: originalMessage.id,
  //       metadata: {
  //         messageType: "ai_response",
  //         stepCount: result.stepCount || 1,
  //         toolCalls: result.toolCalls,
  //         toolResults: result.toolResults,
  //         usage: result.usage,
  //         finishReason: result.finishReason,
  //         timestamp
  //       }
  //     });
  //   } catch (error) {
  //     console.error("Error saving message history:", error);
  //     // Save error message
  //     await this.memory.addMemory({
  //       id: crypto.randomUUID(),
  //       content: "Error saving message history",
  //       author: "system",
  //       createdAt: new Date().toISOString(),
  //       source: "system",
  //       parentId: originalMessage.id,
  //       metadata: {
  //         messageType: "error",
  //         error: error instanceof Error ? error.message : String(error),
  //         timestamp
  //       }
  //     });
  //   }
  // }

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
