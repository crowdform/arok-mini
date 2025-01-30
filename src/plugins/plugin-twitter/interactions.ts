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
import type { Message } from "../../types/message.types";
import type { Tweet } from "agent-twitter-client";

const log = debug("arok:plugin:twitter:interactions");

/**
 * Enhanced response control for Twitter interactions with thread muting
 */
interface ThreadControl {
  isMuted: boolean;
  lastInteraction: number;
  muteReason?: string;
  depth: number;
}

interface InteractionConfig {
  maxThreadDepth: number;
  threadTimeout: number;
  minEngagementScore: number;
  noResponseKeywords: string[];
  skipProbability: number;
}

interface InteractionsConfig extends AutomationConfig {
  maxRepliesPerRun: number;
  maxRepliesPerTweet: number;
}

export class TwitterInteractions extends TwitterAutomationPlugin {
  private processedTweets: Set<string> = new Set();
  private threadControls: Map<string, ThreadControl> = new Map();

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

  private interactionConfig: InteractionConfig = {
    maxThreadDepth: 5,
    threadTimeout: 24 * 60 * 60 * 1000, // 24 hours
    minEngagementScore: 0,
    noResponseKeywords: [
      "stop",
      "quiet",
      "shut up",
      "no more",
      "silence",
      "enough",
      "blocked",
      "reported",
      "spam",
      "bot",
      "no_reply",
      "no_response"
    ],
    skipProbability: 0.2 // 20% chance to randomly skip
  };

  config: InteractionsConfig = {
    enabled: true,
    schedule: "*/5 * * * *", // 15 seconds
    maxRetries: 3,
    timeout: 30000,
    maxRepliesPerRun: 5,
    maxRepliesPerTweet: 1
  };

  actions: Record<string, PluginAction> = {
    FETCH_MENTIONS: {
      execute: async (data: any) => {
        const count = await this.fetchMentions();
        return { count, timestamp: Date.now() };
      }
    }
  };

  async initialize(context: PluginContext): Promise<void> {
    await super.initialize(context);

    // Register cleanup job with scheduler
    await this.context.schedulerService.registerJob({
      id: "twitter:cleanup-threads",
      schedule: "0 * * * *", // Run hourly
      handler: async () => {
        return this.interactionControl.cleanupControls();
      },
      metadata: {
        plugin: this.metadata.name,
        description: "Cleanup old thread controls and maintain cache"
      }
    });

    // Load saved thread controls from cache
    const savedControls = await this.cache.get("twitter:thread_controls");
    if (savedControls) {
      this.threadControls = new Map(Object.entries(savedControls));
    }

    // Initialize processed tweets from cache
    const processedTweets = await this.cache.get("twitter:processed_tweets");
    if (processedTweets) {
      this.processedTweets = new Set(processedTweets);
    }

    log("Twitter interactions plugin initialized");
  }

  async startAutomation(): Promise<void> {
    log("Starting Twitter interactions polling...");

    await this.context.schedulerService.registerJob({
      id: "twitter:poll-mentions",
      schedule: this.config.schedule, // Every 10 minutes
      handler: async () => {
        return this.fetchMentions();
      },
      metadata: {
        plugin: this.metadata.name,
        description: this.metadata.description
      }
    });
  }

  async fetchMentions(): Promise<number> {
    try {
      log("Fetching Twitter mentions...");

      const mentions = await this.client.searchTweets(
        `@${process.env.PLUGIN_TWITTER_USERNAME!}`,
        5,
        SearchMode.Latest
      );

      let count = 0;
      let lastMentionId = await this.cache.get("lastMentionId");

      for await (const mention of mentions) {
        if (!mention.id) {
          continue;
        }

        // Skip if we've already processed this tweet
        if (this.processedTweets.has(mention.id)) {
          log("Skipping processed mention", mention.id);
          continue;
        }

        // Skip self-mentions
        if (mention.username === process.env.PLUGIN_TWITTER_USERNAME) {
          log("Skipping self-mention");
          continue;
        }

        // Check if we should respond to this mention using interaction control
        const { interact: shouldRespond, reason } =
          await this.interactionControl.shouldInteract(mention);

        if (!shouldRespond) {
          log(`Skipping mention ${mention.id}: ${reason}`);
          this.processedTweets.add(mention.id);
          continue;
        }

        // Update last mention ID if this is the newest we've seen
        if (!lastMentionId || mention.id > lastMentionId) {
          lastMentionId = mention.id;
        }

        count++;
        const message = this.client.tweetToMessage(mention);

        // Get AI response
        const replyMessage = await this.context.agentService.handleMessage(
          message,
          {
            postSystemPrompt: this.interactionControl.systemPrompt({
              agentName: this.context.stateService.getCharacter().name,
              twitterUsername: process.env.PLUGIN_TWITTER_USERNAME!
            })
          }
        );

        // Process the response
        await this.processResponse(replyMessage, mention);

        // Mark as processed
        this.processedTweets.add(mention.id);
      }

      // Update cache if we processed any new mentions
      if (count > 0) {
        await this.updateCache(lastMentionId);
        log("Processed %d new mentions", count);
      }

      return count;
    } catch (error) {
      console.error("Error fetching Twitter mentions:", error);
      return 0;
    }
  }

  async processResponse(replyMessage: Message, tweet: Tweet): Promise<void> {
    const threadId = tweet.conversationId || tweet.id;
    if (!threadId) return;

    // Check the AI response using interaction control
    const controlCheck =
      await this.interactionControl.shouldInteractWithAIOutput(
        tweet,
        replyMessage.content
      );

    if (!controlCheck.interact) {
      log(`Skipping response for tweet ${tweet.id}: ${controlCheck.reason}`);
      return;
    }

    // Send the response
    await this.client.sendTweet(replyMessage.content, tweet.id);

    // Process the interaction in the control system
    if (threadId) {
      await this.interactionControl.processInteraction(threadId);
    }
  }

  private async updateCache(lastMentionId: string) {
    try {
      // Keep a bounded set of processed tweets
      const processedArray = Array.from(this.processedTweets);
      if (processedArray.length > 1000) {
        processedArray.splice(0, processedArray.length - 1000);
        this.processedTweets = new Set(processedArray);
      }

      // Update cache
      await this.cache.set("lastMentionId", lastMentionId);
      await this.cache.set("twitter:processed_tweets", processedArray);
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
