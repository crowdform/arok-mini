// src/services/llm.service.ts

import { StateService } from "./state.service";
import type { PluginMetadata } from "./plugins/types";
import type { Message } from "../types/message.types";
import debug from "debug";
import { OpenAIProvider } from "@ai-sdk/openai";

const log = debug("arok:llm-service");

interface AgentResponse {
  action: string | null; // null indicates direct response
  data?: Record<string, any>;
  content: string;
  metadata?: Record<string, any>;
}

export class LLMService {
  private llmInstance: OpenAIProvider;
  private stateService: StateService;
  public llmInstanceModel: string;

  constructor(config: {
    llmInstance: OpenAIProvider;
    stateService: StateService;
    llmInstanceModel: string;
  }) {
    this.llmInstance = config.llmInstance;
    this.stateService = config.stateService;
    this.llmInstanceModel = config.llmInstanceModel;
  }

  //   async processMessage(
  //     message: Message,
  //     history: any[],
  //     availablePlugins: PluginMetadata[],
  //     pluginResponses: Record<string, any>[] = []
  //   ): Promise<AgentResponse> {
  //     try {
  //       // Compose state including any plugin responses
  //       const state = await this.stateService.composeState(
  //         message,
  //         history
  //         // availablePlugins,
  //         // @ts-ignore
  //         // pluginResponses
  //       );

  //       const systemPrompt = `
  // ${this.stateService.buildSystemPrompt(state)} \n\n

  // Your task is to respond to the user message as the character. You have a few options:
  // 1. Determine if another plugin action is needed and specify it
  // 2. Generate a direct response in character
  // 3. Decide that the character has nothing to say and use action : "NO_RESPONSE" to skip
  // \n\n
  // Return a JSON object with:
  // {
  //   "action": string | null,  // Plugin action name or null for direct response
  //   "data": object | null,    // Plugin action parameters if needed
  //   "content": string,        // Either reasoning for plugin action or final response
  //   "metadata": object        // Any additional context to preserve
  // }

  // \n\n
  // Remember:
  // - You can call another plugin if needed
  // - You can respond directly if you have enough information
  // - Stay in character when providing direct responses
  // - Incorporate previous plugin responses naturally`;

  //       const historyContext = this.stateService.buildHistoryContext(state);

  //       log("Processing message with LLM...");
  //       // @ts-ignore
  //       const completion = await this.llmInstance.chat.completions.create({
  //         model: this.llmInstanceModel,
  //         messages: [
  //           { role: "system", content: systemPrompt },
  //           ...historyContext,
  //           { role: "user", content: message.content }
  //         ],
  //         temperature: 0.7,
  //         response_format: { type: "json_object" },
  //         headers: {
  //           "Helicone-User-Id": message.author
  //           // "Helicone-Session-Id": message.parentId || message.id
  //           // "Helicone-Session-Path": `/users/${message.author}/${message.parentId ? `${message.parentId}/` : ""}${message.id}/`,
  //           // "Helicone-Session-Name": `users-${message.author}`
  //         }
  //       });

  //       const response = JSON.parse(
  //         completion.choices[0].message.content || "{}"
  //       ) as AgentResponse;

  //       // Ensure response has required fields
  //       return {
  //         action: response.action || null,
  //         data: response.data || {},
  //         content: response.content || "I'm not sure how to respond to that.",
  //         metadata: response.metadata || {}
  //       };
  //     } catch (error) {
  //       console.error("Error processing message:", error);
  //       return {
  //         action: null,
  //         content:
  //           "I encountered an error processing your message. Please try again.",
  //         metadata: { error: true }
  //       };
  //     }
  //   }
}
