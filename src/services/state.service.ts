// src/services/state.service.ts

import type { Message } from "../types/message.types";
import type { PluginMetadata } from "./plugins/types";
import { MemoryService } from "./memory.service";
import debug from "debug";
import { Metadata } from "agent-twitter-client";

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
    history: any[],
    availablePlugins: PluginMetadata[]
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
      plugins: availablePlugins,
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
    const pluginAvailableActions = state.plugins;
    const pluginPrompts = this.getPluginPrompts(pluginAvailableActions);
    // const pluginResponseContext = this.buildPluginResponseContext(state);
    // const conversationContext = state.conversationSummary
    //   ? `\nConversation context:\n${state.conversationSummary}`
    //   : "";

    return `${characterContext}

# General Information:\n
Date and time: ${new Date().toLocaleString()}

<additional_general_info>
${pluginPrompts ? `# Plugin Contexts:\n${pluginPrompts}\n` : ""}
</additional_plugin_info>

<content_style>
When a final response is needed, response any public facing text/content in the character style:

## Post Style
${state.character.style.all.join("\n")}
### Post Examples
${state.randomExamples.map((ex) => `- "${ex}"`).join("\n")}

## Chat Style
${state.character.style.chat.join("\n")}

Do not be biased by the examples for content, only writing style. The examples are for reference only.
<content_style>

<hints>
- never output JSON or code and call the output final
- prioritize the tools and function calling before answer. 
- always plan first how you should answer the user, and think hard about it then execute it over the multiple tools calls before answering.
- always think about the user's perspective and how they would understand the answer.
- If you do not know the answer, you can ask the user for more information or tell them you do not know.
</hints>
`;
  }

  buildHistoryContext(
    state: StateContext
  ): Array<{ role: string; content: string }> {
    const contextMessages = [];

    // Add recent messages
    for (const msg of state.recentMessages) {
      const author = msg.author || msg?.participants?.[0] || "assistant";
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

  private getPluginPrompts(plugins: PluginMetadata[]): string {
    const pluginPrompts = plugins
      .map((plugin) =>
        typeof plugin?.getSystemPrompt == "function"
          ? plugin.getSystemPrompt()
          : null
      )
      .filter((prompt): prompt is string => prompt !== null)
      .join("\n\n");

    return pluginPrompts;
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
    return `<role> You are ${state.character.name}. ${state.character.system}
\n
Your personality:
${state.randomBio}
\n
Your lore to follow:
${state.randomLore.join("\n")}
\n
</role>`;
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
      return await this.memoryService.getRecentContext(message.author, 15);
    } catch (error) {
      log("Error getting recent messages:", error);
      return [message];
    }
  }

  private getRandomElement<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  public getRandomElements<T>(array: T[], count: number): T[] {
    return [...array].sort(() => 0.5 - Math.random()).slice(0, count);
  }

  updateCharacter(newConfig: Character): void {
    this.character = newConfig;
  }

  getCharacter(): Character {
    return this.character;
  }
}
