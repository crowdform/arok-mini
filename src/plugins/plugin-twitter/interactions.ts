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
  minEngagementScore: number;
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
    minEngagementScore: 0.6,
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
      "bot"
    ],
    skipProbability: 0.2 // 20% chance to randomly skip
  };

  config: InteractionsConfig = {
    enabled: true,
    schedule: "*/5 * * * *", // 15 seconds
    maxRetries: 3,
    timeout: 30000,
    maxRepliesPerRun: 5,
    maxRepliesPerTweet: 1,
    minEngagementScore: 0
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
        return this.cleanupThreadControls();
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

  systemPrompt({
    agentName,
    twitterUsername
  }: {
    agentName: string;
    twitterUsername: string;
  }): string {
    return `
# TASK: Generate a post/reply in the voice, style and perspective of ${agentName} (@${twitterUsername}), always use the query plugin to get more information before answering. Never use hashtags or emojis in the response.

# Thread Control Instructions
- Reply with "NO_RESPONSE" to skip responding to this message
- Reply with "MUTE_THREAD" to stop all future responses in this conversation thread
- ${agentName} should detect when users want to end the conversation and use MUTE_THREAD
- ${agentName} should MUTE_THREAD if the conversation becomes unproductive or hostile

# Interaction Guidelines
For other users:
- ${agentName} should RESPOND to messages directly addressed to them
- ${agentName} should RESPOND to conversations relevant to their background
- ${agentName} should NO_RESPONSE irrelevant messages
- ${agentName} should NO_RESPONSE very short messages unless directly addressed
- ${agentName} should MUTE_THREAD if asked to stop
- ${agentName} should MUTE_THREAD if conversation is concluded
- ${agentName} is in a room with other users and wants to be conversational, but not annoying

IMPORTANT:
- ${agentName} (aka ${twitterUsername}) is particularly sensitive about being annoying
- If there is any doubt, use NO_RESPONSE rather than respond
- Use MUTE_THREAD to permanently stop responding to a conversation thread

Only reply to this tweet if you have something meaningful to say. 
Reply with NO_RESPONSE to skip this message.
Reply with MUTE_THREAD to stop all responses in this conversation.`;
  }

  async shouldRespond(
    tweet: Tweet
  ): Promise<{ respond: boolean; reason?: string }> {
    // Get thread ID - use conversationId or fall back to tweet ID
    const threadId = tweet.conversationId || tweet.id;
    if (!threadId) {
      return { respond: false, reason: "No thread ID available" };
    }

    // Skip if already processed
    if (this.processedTweets.has(tweet.id!)) {
      return { respond: false, reason: "Tweet already processed" };
    }

    // Check if thread is muted
    const threadControl = this.threadControls.get(threadId);
    if (threadControl?.isMuted) {
      return {
        respond: false,
        reason: `Thread muted: ${threadControl.muteReason}`
      };
    }

    // Check thread depth from control
    if (
      threadControl &&
      threadControl.depth > this.interactionConfig.maxThreadDepth
    ) {
      this.muteThread(threadId, "Thread depth exceeded");
      return { respond: false, reason: "Thread too deep" };
    }

    // Check for no-response keywords
    const hasNoResponseKeyword = this.interactionConfig.noResponseKeywords.some(
      (keyword) => tweet.text?.toLowerCase().includes(keyword)
    );
    if (hasNoResponseKeyword) {
      this.muteThread(threadId, "No response keyword detected");
      return { respond: false, reason: "No response keyword detected" };
    }

    // Check engagement score
    const engagementScore = this.calculateEngagementScore(tweet);
    if (engagementScore < this.interactionConfig.minEngagementScore) {
      return { respond: false, reason: "Low engagement score" };
    }

    // Random skip chance
    if (Math.random() < this.interactionConfig.skipProbability) {
      return { respond: false, reason: "Random skip" };
    }

    return { respond: true };
  }

  private muteThread(threadId: string, reason: string): void {
    const control = this.threadControls.get(threadId) || {
      depth: 0,
      lastInteraction: Date.now()
    };

    this.threadControls.set(threadId, {
      ...control,
      isMuted: true,
      muteReason: reason,
      lastInteraction: Date.now()
    });

    this.updateThreadControlCache();
  }

  private calculateEngagementScore(tweet: Tweet): number {
    const likes = tweet.likes || 0;
    const retweets = tweet.retweets || 0;
    const replies = tweet.replies || 0;
    const bookmarks = tweet.bookmarkCount || 0;
    const views = tweet.views || 0;

    return (
      (likes * 0.5 +
        retweets * 1.0 +
        replies * 0.8 +
        bookmarks * 0.3 +
        (views / 1000) * 0.1) /
      100
    );
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
          continue;
        }

        // Skip self-mentions
        if (mention.username === process.env.PLUGIN_TWITTER_USERNAME) {
          log("Skipping self-mention");
          continue;
        }

        // Check if we should respond to this mention
        const { respond, reason } = await this.shouldRespond(mention);
        if (!respond) {
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
            postSystemPrompt: this.systemPrompt({
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

    // Handle special response types
    if (replyMessage.content.includes("MUTE_THREAD")) {
      this.muteThread(threadId, "Explicitly muted by agent");
      return;
    }

    if (replyMessage.content.includes("NO_RESPONSE")) {
      return;
    }

    // Send the response
    await this.client.sendTweet(replyMessage.content, tweet.id);

    // Update thread control
    const existingControl = this.threadControls.get(threadId);
    this.threadControls.set(threadId, {
      isMuted: false,
      lastInteraction: Date.now(),
      depth: (existingControl?.depth || 0) + 1,
      muteReason: undefined
    });

    await this.updateThreadControlCache();
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

  private async updateThreadControlCache(): Promise<void> {
    try {
      await this.cache.set(
        "twitter:thread_controls",
        Object.fromEntries(this.threadControls.entries()),
        { type: "thread_controls", timestamp: Date.now() }
      );
    } catch (error) {
      console.error("Error updating thread control cache:", error);
    }
  }

  private async cleanupThreadControls(): Promise<{
    cleaned: number;
    timestamp: number;
  }> {
    const now = Date.now();
    let cleaned = 0;

    for (const [threadId, control] of this.threadControls.entries()) {
      if (
        now - control.lastInteraction >
        this.interactionConfig.threadTimeout
      ) {
        this.threadControls.delete(threadId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.updateThreadControlCache();
      log(`Cleaned up ${cleaned} old thread controls`);
    }

    return {
      cleaned,
      timestamp: now
    };
  }
}
