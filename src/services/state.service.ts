// src/services/state.service.ts

import type { Message } from "../types/message.types";
import type { PluginMetadata } from "./plugins/types";
import { MemoryService } from "./memory.service";
import debug from "debug";

const log = debug("arok:state-service");

interface CharacterStyle {
  all: string[];
  chat: string[];
  post: string[];
}

interface Character {
  name: string;
  clients: string[];
  plugins: string[];
  modelProvider: string;
  settings: {
    model: string;
    secrets: Record<string, string>;
  };
  system: string;
  bio: string[];
  lore: string[];
  knowledge: string[];
  messageExamples: Array<{ user: string; content: { text: string } }>;
  postExamples: string[];
  adjectives: string[];
  topics: string[];
  style: CharacterStyle;
}

interface PluginResponse {
  action: string;
  result: any;
  timestamp?: number;
}

interface StateContext {
  character: Character;
  currentMessage: Message;
  recentMessages: Message[];
  history: any[];
  plugins: PluginMetadata[];
  pluginResponses: PluginResponse[];
  randomBio: string;
  randomLore: string[];
  randomTopic: string;
  randomExamples: string[];
  conversationSummary?: string;
  lastPluginAction?: string;
  pluginChainDepth: number;
}

export class StateService {
  private character: Character;
  private memoryService: MemoryService;

  constructor(characterConfig: Character, memoryService: MemoryService) {
    this.character = characterConfig;
    this.memoryService = memoryService;
  }

  async composeState(
    message: Message,
    history: any[]
    // availablePlugins: PluginMetadata[],
    // pluginResponses: PluginResponse[] = []
  ): Promise<StateContext> {
    const recentMessages = await this.getRecentMessages(message);
    // const pluginChainDepth = this.calculatePluginChainDepth(pluginResponses);
    const conversationSummary = await this.buildConversationSummary(
      recentMessages
      // @ts-ignore
      // pluginResponses
    );

    // // Get the last plugin action if any
    // const lastPluginAction =
    //   pluginResponses.length > 0
    //     ? pluginResponses[pluginResponses.length - 1].action
    //     : undefined;

    // @ts-ignore
    return {
      character: this.character,
      currentMessage: message,
      recentMessages,
      history,
      // plugins: availablePlugins,
      // pluginResponses,
      randomBio: this.getRandomElement(this.character.bio),
      randomLore: this.getRandomElements(this.character.lore, 3),
      randomTopic: this.getRandomElement(this.character.topics),
      randomExamples: this.getRandomElements(this.character.postExamples, 5),
      conversationSummary
      // lastPluginAction,
      // pluginChainDepth
    };
  }
  // # Available plugins and actions:\n
  // ${pluginDescriptions}
  // \n
  // # Plugin interaction status:\n
  // ${pluginResponseContext}

  buildSystemPrompt(state: StateContext): string {
    // const pluginDescriptions = this.buildPluginDescriptions(state.plugins);
    const characterContext = this.buildCharacterContext(state);
    // const pluginResponseContext = this.buildPluginResponseContext(state);
    // const conversationContext = state.conversationSummary
    //   ? `\nConversation context:\n${state.conversationSummary}`
    //   : "";

    return `${characterContext}

# General Information:\n
Date and time: ${new Date().toLocaleString()}

# When a final response is needed, response in the character style:
${state.character.style.all.join("\n")}
${state.character.style.chat.join("\n")}`;
  }

  buildHistoryContext(
    state: StateContext
  ): Array<{ role: string; content: string }> {
    const contextMessages = [];

    // Add recent messages
    for (const msg of state.recentMessages) {
      const author = msg?.participants?.[0] || "assistant";
      contextMessages.push({
        role: author === "agent" ? "assistant" : "user",
        content: `${msg.content}`
      });
    }

    // Add plugin responses as system messages
    // for (const response of state.pluginResponses) {
    //   contextMessages.push({
    //     role: "system",
    //     content: `Plugin ${response.action} returned: ${JSON.stringify(response.result)}`
    //   });
    // }

    return contextMessages;
  }

  private buildPluginResponseContext(state: StateContext): string {
    if (state.pluginResponses.length === 0) {
      return "No plugins have been called yet.";
    }

    return `Plugin chain depth: ${state.pluginChainDepth}/3
Previous plugin calls:\n
${state.pluginResponses
  .map((resp) => `- ${resp.action}: ${JSON.stringify(resp.result)}`)
  .join("\n")}`;
  }

  private calculatePluginChainDepth(responses: PluginResponse[]): number {
    return responses.length;
  }

  private async buildConversationSummary(
    messages: Message[]
    // pluginResponses: PluginResponse[]
  ): Promise<string> {
    if (messages.length === 0) return "";

    let summary = "Conversation summary:\n";

    // Add message flow
    messages.forEach((msg) => {
      summary += `- ${msg.author}: ${msg.content}\n`;
    });

    // // Add plugin context
    // if (pluginResponses.length > 0) {
    //   summary += "\nPlugin actions taken:\n";
    //   pluginResponses.forEach((resp) => {
    //     summary += `- ${resp.action} was called with result: ${JSON.stringify(resp.result)}\n`;
    //   });
    // }

    return summary;
  }

  private buildCharacterContext(state: StateContext): string {
    return `You are ${state.character.name}.
${state.character.system}
\n
Your personality:
${state.randomBio}
\n
Your recent lore:
${state.randomLore.join("\n")}`;
  }

  private buildPluginDescriptions(plugins: PluginMetadata[]): string {
    return plugins
      .map((plugin) => {
        const actionDescriptions = Object.entries(plugin.actions)
          .map(([name, metadata]) => {
            return `
Action: ${name}
Description: ${metadata.description}
Required Data: ${JSON.stringify(metadata.schema, null, 2)}
Examples:
${metadata.examples.map((ex) => `Input: "${ex.input}" -> Output: "${ex.output}"`).join("\n")}`;
          })
          .join("\n");

        return `
Plugin: ${plugin.name} (v${plugin.version})
Description: ${plugin.description}
Available Actions:
${actionDescriptions}`;
      })
      .join("\n\n");
  }

  private async getRecentMessages(message: Message): Promise<Message[]> {
    try {
      return await this.memoryService.getRecentContext(message.author, 5);
    } catch (error) {
      log("Error getting recent messages:", error);
      return [message];
    }
  }

  private getRandomElement<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  private getRandomElements<T>(array: T[], count: number): T[] {
    return [...array].sort(() => 0.5 - Math.random()).slice(0, count);
  }

  updateCharacter(newConfig: Character): void {
    this.character = newConfig;
  }

  getCharacter(): Character {
    return this.character;
  }
}
