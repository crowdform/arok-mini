import {
  PluginMetadata,
  PluginAction,
  ActionExecutionContext,
  PluginContext
} from "../../services/plugins/types";
import { TwitterAutomationPlugin, AutomationConfig } from "./base";
import debug from "debug";
import { ACTIONS } from "./actions";

const log = debug("arok:plugin:twitter");

export class TwitterPlugin extends TwitterAutomationPlugin {
  metadata: PluginMetadata = {
    name: "twitter_actions",
    description: "Twitter automation and integration plugin",
    version: "1.0.0",
    callable: true,
    actions: {} // Will be populated in initialize
  };

  config: AutomationConfig = {
    enabled: true,
    schedule: "*/30 * * * *",
    maxRetries: 3,
    timeout: 30000
  };

  actions = {}; // Will be populated in initialize

  async initialize(context: PluginContext): Promise<void> {
    await super.initialize(context);

    // Load all Twitter actions
    for (const [key, action] of Object.entries(ACTIONS)) {
      // Add action metadata to plugin actions
      this.metadata.actions[key] = {
        description: action.description || key,
        // @ts-ignore
        schema: action.schema || { type: "object", properties: {} },
        // @ts-ignore
        examples: action.examples || [],
        scope: ["*"]
      };

      // Create wrapped action with Twitter client injection
      // @ts-ignore
      this.actions[key] = {
        execute: async (params: any) => {
          try {
            log(`Executing Twitter action ${key}`);
            const result = await action.handler(this.client, params);
            const json = JSON.parse(JSON.stringify(result, null, 2));
            // Execute action with Twitter client
            return json;
          } catch (error) {
            console.error(`Error executing Twitter action ${key}:`, error);
            throw error;
          }
        }
      };
    }

    log("Twitter plugin initialized with actions:", Object.keys(this.actions));
  }

  async startAutomation() {}
}

// Action interfaces
interface TwitterActionContext {
  client: any; // Twitter client type
  context: PluginContext;
}

export type TwitterAction = (
  params: any & TwitterActionContext
) => Promise<any>;

// Helper to ensure each action has required metadata
export interface TwitterActionDefinition {
  description?: string;
  schema?: any;
  examples?: Array<{
    input: any;
    output: any;
  }>;
  execute: TwitterAction;
}
