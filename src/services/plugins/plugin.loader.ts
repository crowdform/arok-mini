import { AgentService } from "../../services/agent.service";

interface PluginConfig {
  name: string;
  config?: Record<string, any>;
}

type PluginDefinition = string | PluginConfig;

export class PluginLoader {
  agent: AgentService;
  app: any;
  private pluginMap: Map<string, () => Promise<any>>;

  constructor(agent: AgentService, app: any) {
    this.agent = agent;
    this.app = app;
    this.pluginMap = new Map([
      [
        "query",
        () => import("../../plugins/plugin-query").then((m) => m.QueryPlugin)
      ],
      [
        "twitter-actions",
        () =>
          import("../../plugins/plugin-twitter").then((m) => m.TwitterPlugin)
      ],
      [
        "twitter-replies",
        () =>
          import("../../plugins/plugin-twitter").then(
            (m) => m.TwitterRepliesPlugin
          )
      ],
      [
        "twitter-tweets",
        () =>
          import("../../plugins/plugin-twitter").then(
            (m) => m.TwitterTweetsPlugin
          )
      ],
      [
        "twitter-interactions",
        () =>
          import("../../plugins/plugin-twitter").then(
            (m) => m.TwitterInteractions
          )
      ],
      [
        "api",
        () => import("../../plugins/plugin-api").then((m) => m.APIPlugin)
      ],
      [
        "telegram",
        () =>
          import("../../plugins/plugin-telegram").then((m) => m.TelegramPlugin)
      ],
      [
        "solana",
        () => import("../../plugins/plugin-solana").then((m) => m.SolanaPlugin)
      ],
      [
        "activity",
        () =>
          import("../../plugins/plugin-activity").then((m) => m.ActivityPlugin)
      ]
    ]);
  }

  /**
   * Create plugin instance based on config
   */
  private async createPluginInstance(
    name: string,
    config: Record<string, any> | null = null
  ): Promise<any> {
    const pluginLoader = this.pluginMap.get(name.toLowerCase());
    if (!pluginLoader) {
      throw new Error(`Unknown plugin: ${name}`);
    }

    try {
      const PluginClass = await pluginLoader();

      // Handle plugins that need app instance
      if (name.toLowerCase() === "api") {
        return new PluginClass({ app: this.app, ...config });
      }

      // Create instance with or without config
      return config ? new PluginClass(config) : new PluginClass();
    } catch (error) {
      console.error(`Error loading plugin ${name}:`, error);
      throw error;
    }
  }

  /**
   * Load and register plugins from configuration
   */
  async loadPlugins(pluginConfigs: PluginDefinition[]): Promise<void> {
    try {
      // Load plugins in parallel
      const pluginPromises = pluginConfigs.map(async (pluginConfig) => {
        if (typeof pluginConfig === "string") {
          const plugin = await this.createPluginInstance(pluginConfig);
          await this.agent.registerPlugin(plugin);
          return;
        }

        const { name, config } = pluginConfig;
        const plugin = await this.createPluginInstance(name, config);
        await this.agent.registerPlugin(plugin);
      });

      await Promise.all(pluginPromises);
    } catch (error) {
      console.error("Error loading plugins:", error);
      throw error;
    }
  }

  /**
   * Get list of available plugins
   */
  getAvailablePlugins(): string[] {
    return Array.from(this.pluginMap.keys());
  }
}
