// src/plugins/plugin-twitter/interaction-control.ts

import { Tweet } from "./twitter.client";
import debug from "debug";
import { PluginContext } from "../../services/plugins/types";

const log = debug("arok:twitter:interaction-control");

export interface InteractionControl {
  isMuted: boolean;
  lastInteraction: number;
  muteReason?: string;
  depth: number;
  skipReason?: string;
}

export interface InteractionConfig {
  maxThreadDepth: number;
  threadTimeout: number;
  minEngagementScore: number;
  noResponseKeywords: string[];
  skipProbability: number;
}

interface DetectionResult {
  shouldPost: boolean;
  controlType?: "NO_RESPONSE" | "MUTE_THREAD";
  reason?: string;
}

export class TwitterInteractionControl {
  private processedItems: Set<string> = new Set();
  private controls: Map<string, InteractionControl> = new Map();
  private cachePrefix: string;

  protected readonly config: InteractionConfig = {
    maxThreadDepth: 5,
    threadTimeout: 48 * 60 * 60 * 1000, // 24 hours
    minEngagementScore: 0,
    noResponseKeywords: [
      "blocked",
      "reported",
      "spam",
      "no_reply",
      "no_response",
      "no response",
      "NO RESPONSE",
      "NO_RESPONSE",
      "MUTE_THREAD",
      // tools calling filters
      "FUNCTION",
      "function",
      "{",
      "}",
      "[",
      '"name"',
      "try again",
      //
      "BTC",
      "btc",
      "bitcoin",
      "successfully posted",
      "tweet"
    ],
    skipProbability: 0 // 20% chance to randomly skip
  };

  constructor(
    pluginName: string,
    private cacheService: PluginContext["cacheService"],
    private stateService: PluginContext["stateService"]
  ) {
    this.cachePrefix = `twitter:${pluginName}:`;
    this.cacheService = cacheService;
    this.stateService = stateService;
    this.initialize();
  }

  /**
   * Initialize the interaction control
   * Should be called after construction
   */
  async initialize(): Promise<void> {
    await this.loadFromCache();
    log(`Initialized interaction control for ${this.cachePrefix}`);
  }

  /**
   * Analyzes AI output to determine if it should be posted based on control keywords
   * @param aiOutput - The generated text from the AI
   * @returns Object containing posting decision and reason
   */
  public detectControlResponse(aiOutput: string): DetectionResult {
    if (!aiOutput) {
      return {
        shouldPost: false,
        reason: "Empty output"
      };
    }

    // Check if the output is JSON
    try {
      const jsonOutput = JSON.parse(aiOutput);

      // If it's JSON, we only want to process it if it has a 'content' field
      if (jsonOutput && typeof jsonOutput === "object") {
        if (!jsonOutput.content) {
          return {
            shouldPost: false,
            reason: "JSON response missing content field"
          };
        }
        // Use the content field for further processing
        aiOutput = jsonOutput.content;
      }
    } catch (e) {
      // Not JSON or malformed JSON - continue with normal processing
    }

    // Normalize the input
    const normalizedOutput = aiOutput.trim();

    // Check for exact NO_RESPONSE match
    if (normalizedOutput === "NO_RESPONSE") {
      return {
        shouldPost: false,
        controlType: "NO_RESPONSE",
        reason: "Explicit NO_RESPONSE command"
      };
    }

    // Check for exact MUTE_THREAD match
    if (normalizedOutput === "MUTE_THREAD") {
      return {
        shouldPost: false,
        controlType: "MUTE_THREAD",
        reason: "Explicit MUTE_THREAD command"
      };
    }

    // Check against noResponseKeywords (case insensitive)
    const lowerOutput = normalizedOutput.toLowerCase();
    for (const keyword of this.config.noResponseKeywords) {
      if (lowerOutput.includes(keyword.toLowerCase())) {
        return {
          shouldPost: false,
          controlType: "NO_RESPONSE",
          reason: `Contains no-response keyword: ${keyword}`
        };
      }
    }

    // If no control keywords found, allow posting
    return {
      shouldPost: true
    };
  }

  public async shouldInteractWithAIOutput(
    tweet: Tweet,
    aiOutput: string
  ): Promise<{ interact: boolean; reason?: string }> {
    // First check the AI output
    const controlCheck = this.detectControlResponse(aiOutput);
    if (!controlCheck.shouldPost) {
      if (controlCheck.controlType === "MUTE_THREAD" && tweet.conversationId) {
        await this.muteThread(
          tweet.conversationId,
          controlCheck.reason || "AI requested thread mute"
        );
      }
      return { interact: false, reason: controlCheck.reason };
    }

    // Then perform normal interaction checks
    return this.shouldInteract(tweet);
  }

  public async shouldInteract(
    tweet: Tweet
  ): Promise<{ interact: boolean; reason?: string }> {
    const threadId = tweet.conversationId || tweet.id;
    if (!threadId) {
      return { interact: false, reason: "No thread ID available" };
    }

    // Skip if already processed
    if (this.processedItems.has(tweet.id!)) {
      return { interact: false, reason: "Already processed" };
    }

    // Check if thread is muted
    const control = this.controls.get(threadId);
    if (control?.isMuted) {
      return { interact: false, reason: `Thread muted: ${control.muteReason}` };
    }

    // Check thread depth
    if (control && control.depth > this.config.maxThreadDepth) {
      await this.muteThread(threadId, "Thread depth exceeded");
      return { interact: false, reason: "Thread too deep" };
    }

    // Check for no-response keywords
    const hasNoResponseKeyword = this.config.noResponseKeywords.some(
      (keyword) => tweet.text?.toLowerCase().includes(keyword.toLowerCase())
    );
    if (hasNoResponseKeyword) {
      await this.muteThread(threadId, "No response keyword detected");
      return { interact: false, reason: "No response keyword detected" };
    }

    // Check engagement score
    const engagementScore = this.calculateEngagementScore(tweet);
    if (engagementScore < this.config.minEngagementScore) {
      return { interact: false, reason: "Low engagement score" };
    }

    // Random skip chance
    if (Math.random() < this.config.skipProbability) {
      return { interact: false, reason: "Random skip" };
    }

    return { interact: true };
  }

  public async muteThread(threadId: string, reason: string): Promise<void> {
    const control = this.controls.get(threadId) || {
      isMuted: false,
      depth: 0,
      lastInteraction: Date.now()
    };

    this.controls.set(threadId, {
      ...control,
      isMuted: true,
      muteReason: reason,
      lastInteraction: Date.now()
    });

    await this.updateControlCache();
  }

  public async processInteraction(threadId: string): Promise<void> {
    const control = this.controls.get(threadId) || {
      isMuted: false,
      depth: 0,
      lastInteraction: Date.now()
    };

    this.controls.set(threadId, {
      ...control,
      depth: control.depth + 1,
      lastInteraction: Date.now()
    });

    await this.updateControlCache();
  }

  markProcessed(id: string): void {
    this.processedItems.add(id);
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

  private async updateControlCache(): Promise<void> {
    try {
      // Get cache service from constructor or context
      const cacheKey = `${this.cachePrefix}interaction_controls`;

      // Convert controls map to a serializable object
      const controlsObject = Object.fromEntries(
        Array.from(this.controls.entries()).map(([threadId, control]) => [
          threadId,
          {
            ...control,
            lastInteraction: control.lastInteraction || Date.now()
          }
        ])
      );

      // Save processed items set
      const processedArray = Array.from(this.processedItems);
      if (processedArray.length > 1000) {
        // Keep only the latest 1000 processed items
        processedArray.splice(0, processedArray.length - 1000);
        this.processedItems = new Set(processedArray);
      }

      // Build cache entry
      const cacheEntry = {
        controls: controlsObject,
        processedItems: processedArray,
        updatedAt: Date.now(),
        metadata: {
          type: "interaction_controls",
          itemCount: this.processedItems.size,
          controlCount: this.controls.size,
          timestamp: Date.now()
        }
      };

      await this.cacheService.set(cacheKey, cacheEntry);

      log(
        `Updated interaction controls cache with ${this.controls.size} controls and ${this.processedItems.size} processed items`
      );
    } catch (error) {
      console.error("Error updating interaction controls cache:", error);
      throw error;
    }
  }

  // Add method to load cache
  public async loadFromCache(): Promise<void> {
    try {
      const cacheKey = `${this.cachePrefix}interaction_controls`;
      const cached = await this.cacheService.get(cacheKey);

      if (cached) {
        // Restore controls
        this.controls = new Map(
          Object.entries(cached.controls).map(([threadId, control]) => [
            threadId,
            control as InteractionControl
          ])
        );

        // Restore processed items
        this.processedItems = new Set(cached.processedItems || []);

        log(
          `Loaded ${this.controls.size} controls and ${this.processedItems.size} processed items from cache`
        );
      }
    } catch (error) {
      console.error("Error loading interaction controls from cache:", error);
      // Don't throw - start fresh if cache load fails
    }
  }

  async cleanupControls(): Promise<{ cleaned: number; timestamp: number }> {
    const now = Date.now();
    let cleaned = 0;

    for (const [threadId, control] of this.controls.entries()) {
      if (now - control.lastInteraction > this.config.threadTimeout) {
        this.controls.delete(threadId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.updateControlCache();
      log(`Cleaned up ${cleaned} old thread controls`);
    }

    return {
      cleaned,
      timestamp: now
    };
  }

  public systemPrompt({
    agentName,
    twitterUsername
  }: {
    agentName: string;
    twitterUsername: string;
  }): string {
    return `
# TASK: Generate a post/reply in the voice, style and perspective of ${agentName} (@${twitterUsername}).

## Steps to follow:

1. Decide if should be responded to
2. Use the Query plugin to get more information about the topic - market data, news, etc.
3. Answer with just the tweet content using all information. Never use hashtags or emojis.

# Response Control Instructions
- Reply with "NO_RESPONSE" to skip responding to this message
- Reply with "MUTE_THREAD" to stop all future responses in this conversation thread
- ${agentName} should detect when users want to end the conversation and use MUTE_THREAD
- ${agentName} should MUTE_THREAD if the conversation becomes unproductive or hostile

# Interaction Guidelines
- ${agentName} should RESPOND to messages directly addressed to them
- ${agentName} should RESPOND to conversations relevant to their background
- ${agentName} should NO_RESPONSE irrelevant messages
- ${agentName} should NO_RESPONSE very short messages unless directly addressed
- ${agentName} should MUTE_THREAD if asked to stop
- ${agentName} should MUTE_THREAD if conversation is concluded

IMPORTANT:
- ${agentName} (aka ${twitterUsername}) is particularly sensitive about being annoying or spammy
- If there is any doubt, use NO_RESPONSE rather than respond
- Use MUTE_THREAD to permanently stop responding to a conversation thread

Only reply if you have something meaningful to say.
Reply with NO_RESPONSE to skip this message.
Reply with MUTE_THREAD to stop all responses in this conversation.

# Example Post Response Style:

${this.stateService
  .getRandomElements(this.stateService.getCharacter().postExamples, 5)
  .map((ex) => `> ${ex}`)
  .join("\n")}
  
  
Reminder never use hashtags or emojis in the Twitter content.
  `;
  }
}
