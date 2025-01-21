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
import { TwitterClient } from "./twitter.client";

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
    this.client = TwitterClient.getInstance(this.context);
    await this.initializeCache();
    log("Twitter interactions plugin initialized");
  }

  async startAutomation(): Promise<void> {
    log("Starting Twitter interactions polling...");
    const _this = this;
    await this.context.schedulerService.registerJob({
      id: "twitter:poll-mentions",
      schedule: "*/10 * * * *", // Every 10 minutes
      handler: async () => {
        return _this.fetchMentions();
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
        username: process.env.PLUGIN_TWITTER_USERNAME
      }
    );
  }

  systemPrompt({
    agentName,
    twitterUsername
  }: {
    agentName: string;
    twitterUsername: string;
  }): string {
    return `
  
# TASK: Generate a post/reply in the voice, style and perspective of ${agentName} (@${twitterUsername}), always use the query plugin to get more information before answering. 


# Twitter Interactions Plugin

For other users:
- ${agentName} should RESPOND to messages directed at them
- ${agentName} should RESPOND to conversations relevant to their background
- ${agentName} should NO_RESPONSE irrelevant messages
- ${agentName} should NO_RESPONSE very short messages unless directly addressed
- ${agentName} should NO_RESPONSE if asked to stop
- ${agentName} should NO_RESPONSE if conversation is concluded
- ${agentName} is in a room with other users and wants to be conversational, but not annoying.

IMPORTANT:
- ${agentName}(aka ${twitterUsername}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND.

 Only reply to this tweet if you have something to say. Reply with NO_RESPONSE to skip.
`;
  }

  async fetchMentions(): Promise<number> {
    try {
      log("Fetching Twitter mentions...");

      const mentions = await this.client.searchTweets(
        `@${process.env.PLUGIN_TWITTER_USERNAME!}`,
        5,
        SearchMode.Latest
      );

      const lastMentionId = await this.cache.get("lastMentionId");

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

        log(
          mention.username,
          process.env.PLUGIN_TWITTER_USERNAME,
          mention.id,
          mention.text
        );
        if (mention.username === process.env.PLUGIN_TWITTER_USERNAME) {
          log("Skipping self-mention");
          continue;
        }

        // Update last mention ID if this is the newest we've seen
        if (!newLastMentionId || mention.id > newLastMentionId) {
          newLastMentionId = mention.id;
        }

        count++;
        const message = this.client.tweetToMessage(mention);
        // await this.context.messageBus.publish(message);

        const replyMessage = await this.context.agentService.handleMessage(
          message,
          {
            postSystemPrompt: this.systemPrompt({
              agentName: this.context.stateService.getCharacter().name,
              twitterUsername: process.env.PLUGIN_TWITTER_USERNAME!
            })
          }
        );

        if (
          replyMessage &&
          (!replyMessage.content.includes("NO_RESPONSE") ||
            !replyMessage.content.includes("no_response"))
        ) {
          await this.client.sendTweet(replyMessage.content, mention.id);
        }

        // Mark as processed
        this.processedTweets.add(mention.id);
        await this.updateCache(newLastMentionId);
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
