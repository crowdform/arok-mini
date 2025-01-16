// src/plugins/plugin-twitter/interactions.ts
import {
  ExtendedPlugin,
  PluginContext,
  PluginMetadata,
  PluginAction
} from "../../services/plugins/types";
import { TwitterAutomationPlugin, AutomationConfig } from "./base";
import debug from "debug";
import { SearchMode } from "agent-twitter-client";

const log = debug("arok:plugin:twitter:interactions");

interface InteractionsConfig extends AutomationConfig {
  maxRepliesPerRun: number;
  maxRepliesPerTweet: number;
  searchTermRotationInterval: number;
  minEngagementScore: number;
}

export class TwitterInteractions extends TwitterAutomationPlugin {
  private processedTweets: Set<string> = new Set();

  metadata: PluginMetadata = {
    name: "twitter_interactions",
    description: "Handles Twitter interactions and mentions",
    version: "1.0.0",
    callable: false,
    actions: {
      FETCH_MENTIONS: {
        description: "Fetches recent mentions from Twitter",
        schema: {
          type: "object",
          properties: {
            count: {
              type: "number",
              description: "Number of mentions to fetch",
              required: false
            }
          },
          required: ["count"]
        },
        examples: [
          {
            input: "Fetch latest mentions",
            output: "Found and processed 5 new mentions"
          }
        ]
      }
    }
  };

  config: InteractionsConfig = {
    enabled: true,
    schedule: "*/15 * * * *",
    maxRetries: 3,
    timeout: 30000,
    maxRepliesPerRun: 5,
    maxRepliesPerTweet: 1,
    searchTermRotationInterval: 4 * 60 * 60 * 1000,
    minEngagementScore: 0.6
  };

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;

    this.cache = this.context.cacheService;
    await this.initializeCache();
    log("Twitter interactions plugin initialized");
  }

  async startAutomation(): Promise<void> {
    log("Starting Twitter interactions polling...");
    await this.context.schedulerService.registerJob({
      id: "twitter:poll-mentions",
      schedule: "*/10 * * * *", // Every 10 minutes
      handler: async () => {
        return this.fetchMentions();
      },
      metadata: {
        plugin: this.metadata.name,
        description: this.metadata.description
      }
    });
  }

  actions: Record<string, PluginAction> = {
    FETCH_MENTIONS: {
      execute: async (data: any) => {
        const count = await this.fetchMentions();
        return { count, timestamp: Date.now() };
      }
    }
  };

  private async initializeCache() {
    const lastMentionId = await this.cache.get("lastMentionId");
    const processedTweets = (await this.cache.get("processedTweets")) || [];

    if (processedTweets.length > 0) {
      this.processedTweets = new Set(processedTweets);
    }

    await this.cache.set(
      "twitter_state",
      {
        lastMentionId,
        lastPollTime: Date.now(),
        processedTweets: Array.from(this.processedTweets)
      },
      {
        type: "twitter_state",
        username: process.env.TWITTER_USERNAME
      }
    );
  }

  async fetchMentions(): Promise<number> {
    try {
      const scraper = this.client.getScraper();
      const lastMentionId = await this.cache.get("lastMentionId");
      const mentions = await scraper.searchTweets(
        `@${process.env.TWITTER_USERNAME!}`,
        20,
        SearchMode.Latest
      );

      let count = 0;
      let newLastMentionId = lastMentionId;

      for await (const mention of mentions) {
        if (!mention.id) {
          continue;
        }
        // Skip if we've already processed this tweet
        if (this.processedTweets.has(mention.id)) {
          continue;
        }

        // Update last mention ID if this is the newest we've seen
        if (!newLastMentionId || mention.id > newLastMentionId) {
          newLastMentionId = mention.id;
        }

        count++;
        const message = this.client.tweetToMessage(mention);
        await this.context.messageBus.publish(message);

        // Mark as processed
        this.processedTweets.add(mention.id);
      }

      // Update cache if we processed any new mentions
      if (count > 0) {
        await this.updateCache(newLastMentionId);
        log("Processed %d new mentions", count);
      }

      return count;
    } catch (error) {
      console.error("Error fetching Twitter mentions:", error);
      return 0;
    }
  }

  private async updateCache(lastMentionId: string) {
    try {
      // Keep a bounded set of processed tweets (e.g., last 1000)
      const processedArray = Array.from(this.processedTweets);
      if (processedArray.length > 1000) {
        processedArray.splice(0, processedArray.length - 1000);
        this.processedTweets = new Set(processedArray);
      }

      // Update cache
      await this.cache.set("lastMentionId", lastMentionId);
      await this.cache.set("processedTweets", processedArray);
      await this.cache.update("twitter_state", {
        lastMentionId,
        lastPollTime: Date.now(),
        processedTweets: processedArray
      });
    } catch (error) {
      console.error("Error updating cache:", error);
    }
  }
}
