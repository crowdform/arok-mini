import {
  Plugin,
  PluginContext,
  PluginMetadata,
  ExtendedPlugin,
  PluginAction
} from "./types";
import { Message } from "../../types/message.types";
import debug from "debug";

const log = debug("arok:plugin-manager");

export class PluginManager {
  private plugins: Map<string, Plugin | ExtendedPlugin> = new Map();
  private context: PluginContext;

  constructor(context: PluginContext) {
    this.context = context;
  }

  async registerPlugin(plugin: Plugin | ExtendedPlugin): Promise<void> {
    try {
      await plugin.initialize(this.context);
      this.plugins.set(plugin.metadata.name, plugin);

      log(`Plugin ${plugin.metadata.name} registered successfully`);
    } catch (error) {
      console.error(
        `Failed to register plugin ${plugin.metadata.name}:`,
        error
      );
      throw error;
    }
  }

  getSystemPrompts(): string[] {
    return Array.from(this.plugins.values())
      .map((plugin) => {
        if (
          "getSystemPrompt" in plugin &&
          typeof plugin.getSystemPrompt === "function"
        ) {
          const prompt = plugin.getSystemPrompt();
          return prompt
            ? `\n# Plugin: ${plugin.metadata.name}\n${prompt}`
            : null;
        }
        return null;
      })
      .filter((prompt): prompt is string => prompt !== null);
  }

  async handleIntent(
    intent: string,
    message: Message,
    data: any
  ): Promise<any> {
    for (const plugin of this.plugins.values()) {
      if (plugin.metadata.actions[intent]) {
        if (this.isExtendedPlugin(plugin)) {
          const action = plugin.actions[intent];
          if (action && "execute" in action) {
            try {
              const result = await action.execute(data, {
                parentMessage: message,
                chainId: message.metadata?.chainId,
                actionOrder: message.metadata?.actionOrder,
                dependencyResults: message.metadata?.dependencyResults
              });

              // Save plugin result to memory
              await this.savePluginResult(
                message,
                intent,
                result,
                plugin.metadata.name
              );

              // Return the actual result instead of just true/false
              return result;
            } catch (error) {
              console.error(`Error executing plugin action ${intent}:`, error);
              throw error;
            }
          }
        } else {
          const action = plugin.actions[intent];
          if (action && typeof action === "function") {
            const result = await action(message, data);
            await this.savePluginResult(
              message,
              intent,
              result,
              plugin.metadata.name
            );
            return result;
          }
        }
      }
    }
    return null;
  }

  private async savePluginResult(
    message: Message,
    intent: string,
    result: any,
    pluginName: string
  ): Promise<void> {
    const resultMessage: Message = {
      id: crypto.randomUUID(),
      content: typeof result === "string" ? result : JSON.stringify(result),
      author: `plugin:${pluginName}`,
      participants: [message.author],
      createdAt: new Date().toISOString(),
      source: "plugin",
      type: "response",
      requestId: message.id,
      metadata: {
        pluginName,
        intent,
        result,
        isPluginResult: true,
        timestamp: Date.now()
      }
    };

    // Save to memory service
    await this.context.memoryService.addMemory(resultMessage);

    // // Publish to message bus
    // await this.context.messageBus.publish(resultMessage);
  }

  private isExtendedPlugin(
    plugin: Plugin | ExtendedPlugin
  ): plugin is ExtendedPlugin {
    return (
      "actions" in plugin &&
      Object.values(plugin.actions).some(
        (action) => action && typeof action === "object" && "execute" in action
      )
    );
  }

  getRegisteredIntents(): string[] {
    const intents: string[] = [];
    for (const plugin of this.plugins.values()) {
      intents.push(...Object.keys(plugin.metadata.actions));
    }
    return [...new Set(intents)];
  }

  getRegisteredPlugins(): (Plugin | ExtendedPlugin)[] {
    return Array.from(this.plugins.values());
  }

  getPluginMetadata(): PluginMetadata[] {
    return Array.from(this.plugins.values())
      .map((plugin) => plugin.metadata)
      .filter((plugin) => plugin.callable);
  }
}
