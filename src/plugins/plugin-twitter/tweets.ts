// src/plugins/plugin-twitter/tweets.ts
import {
  PluginMetadata,
  PluginAction,
  ActionExecutionContext,
  PluginContext
} from "../../services/plugins/types";
import { TwitterAutomationPlugin, AutomationConfig } from "./base";
import { Message } from "../../types/message.types";
import debug from "debug";

const log = debug("arok:plugin:twitter-tweets");

interface TweetGenerationConfig extends AutomationConfig {
  topicsPerTweet: number;
  maxTweetsPerRun: number;
  minInterval: number;
  useTrendingTopics: boolean;
}

interface TopicData {
  topic: string;
  relevance: number;
  lastUsed: number;
  source: "character" | "generated" | "trending";
}

interface TopicCache {
  topics: TopicData[];
  lastUpdated: number;
  generationCount: number;
}

export class TwitterTweetsPlugin extends TwitterAutomationPlugin {
  private lastTweetTime: number = 0;
  private readonly TOPIC_CACHE_KEY = "twitter:tweet_topics";

  metadata: PluginMetadata = {
    name: "twitter_tweets_automation",
    description: "Automates generating and posting Twitter content",
    version: "1.0.0",
    callable: true,
    actions: {
      GENERATE_TOPICS: {
        description: "Generate and update tweet topics",
        scope: ["automation"],
        schema: {
          type: "object",
          properties: {
            count: {
              type: "number",
              description: "Number of topics to generate"
            }
          },
          required: ["count"]
        },
        examples: [
          {
            input: "Generate 5 new topics",
            output: "Generated and cached new topics"
          }
        ]
      },
      POST_CONTENT: {
        scope: ["*"],
        description: `Post to content to platforms directly.`,
        schema: {
          type: "object",
          properties: {
            postContent: {
              type: "string",
              description:
                "Post content (max 280 characters), lowercase, no hashtags or emojis in the content."
            }
          },
          required: ["postContent"]
        },
        examples: [
          {
            input: { postContent: "Hello world!" },
            output: "Content posted successfully"
          }
        ]
      },
      GENERATE_TWEET: {
        scope: ["automation"],
        description: "Generate and post a new tweet using available topics",
        schema: {
          type: "object",
          properties: {
            topics: {
              type: "array",
              items: { type: "string" },
              description: "Topics to tweet about"
            }
          },
          required: ["topics"]
        },
        examples: [
          {
            input: { topics: ["AI trading", "market psychology"] },
            output: {
              status: "sent",
              topics: ["AI trading", "market psychology"],
              timestamp: 1673344400000,
              content:
                "watching retail chase pumps while ais quietly build consciousness layer\nfascinating study in evolutionary dynamics"
            }
          },
          {
            input: { topics: ["memetic value", "cultural analysis"] },
            output: {
              status: "skipped",
              topics: ["memetic value", "cultural analysis"],
              reason: "Too soon since last tweet"
            }
          }
        ]
      }
    }
  };

  config: TweetGenerationConfig = {
    enabled: true,
    schedule: "*/30 * * * *", // Every 30 minutes
    maxRetries: 3,
    timeout: 30000,
    topicsPerTweet: 2,
    maxTweetsPerRun: 1,
    minInterval: 30 * 60 * 1000, // 30 minutes minimum between tweets
    useTrendingTopics: true
  };

  actions = {
    GENERATE_TOPICS: {
      execute: async (data: { count: number }) => {
        return this.generateAndUpdateTopics(data.count);
      }
    },
    GENERATE_TWEET: {
      execute: async (data: { topics: string[] }) => {
        return this.generateAndPostTweet(data.topics);
      }
    },
    POST_CONTENT: {
      execute: async (data: { postContent: string }) => {
        return this.postTweet(data.postContent);
      }
    }
  };

  async initialize(context: PluginContext): Promise<void> {
    await super.initialize(context);

    // Initialize topics if cache is empty
    const cachedTopics = await this.cache.get(this.TOPIC_CACHE_KEY);
    if (!cachedTopics) {
      await this.initializeTopicsFromCharacter();
    }

    log("Tweet plugin initialized");
  }

  private async initializeTopicsFromCharacter(): Promise<void> {
    const characterTopics = this.context.stateService.getCharacter().topics;
    const initialTopics: TopicData[] = characterTopics.map((topic) => ({
      topic,
      relevance: 1.0,
      lastUsed: 0,
      source: "character"
    }));

    const topicCache: TopicCache = {
      topics: initialTopics,
      lastUpdated: Date.now(),
      generationCount: 0
    };

    await this.cache.set(this.TOPIC_CACHE_KEY, topicCache);
    log("Initialized topics from character config");
  }

  protected async startAutomation(): Promise<void> {
    log("Starting tweet automation...");

    // Register topic update job
    await this.context.schedulerService.registerJob({
      id: "twitter:update-topics",
      schedule: "0 */2 * * *", // Every 2 hours
      handler: async () => {
        return this.generateAndUpdateTopics(10); // Generate 10 topics every run
      },
      metadata: {
        plugin: this.metadata.name,
        description: "Update tweet topics periodically"
      }
    });

    // Register tweet posting job
    await this.context.schedulerService.registerJob({
      id: "twitter:post-tweets",
      schedule: "0 */3 * * *", // Every 3hours
      handler: async () => {
        const topics = await this.getRelevantTopics(1);
        return this.generateAndPostTweet(topics.map((t) => t.topic));
      },
      metadata: {
        plugin: this.metadata.name,
        description: "Generate and post tweets"
      }
    });
  }

  private async generateAndUpdateTopics(count: number): Promise<{
    generated: number;
    timestamp: number;
  }> {
    try {
      // Get current topics from cache
      let topicCache: TopicCache = (await this.cache.get(
        this.TOPIC_CACHE_KEY
      )) || {
        topics: [],
        lastUpdated: 0,
        generationCount: 0
      };

      // Generate new topics using Query plugin
      const queryPrompt = `Analyze current market trends and generate ${count} engaging tweet topics. For updated information call the tools plugins before answering.
        Consider existing topics: ${topicCache.topics
          .slice(0, 5)
          .map((t) => t.topic)
          .join(
            ", "
          )} Never use the same topic twice in a row. Never use hashtags.
        Output as JSON array of strings.`;

      const result = await this.queryPlugin(queryPrompt, {
        type: "topic_generation"
      });

      // Parse new topics
      let newTopics: string[] = [];
      try {
        newTopics =
          this.context.agentService.responseParser.parseStringArray(result);
      } catch (e) {
        newTopics = [result];
      }

      // Create new topic data entries
      const newTopicData: TopicData[] = newTopics.map((topic) => ({
        topic,
        relevance: 1.0,
        lastUsed: 0,
        source: "generated"
      }));

      // Update existing topics' relevance
      topicCache.topics = topicCache.topics.map((topic) => ({
        ...topic,
        relevance: Math.max(0.1, topic.relevance * 0.9) // Decay relevance
      }));

      // Add new topics
      topicCache.topics = [...topicCache.topics, ...newTopicData].sort(
        (a, b) => b.relevance - a.relevance
      );

      // Keep only top 100 topics
      topicCache.topics = topicCache.topics.slice(0, 100);

      // Update cache
      topicCache.lastUpdated = Date.now();
      topicCache.generationCount++;
      await this.cache.set(this.TOPIC_CACHE_KEY, topicCache);

      log(`Generated ${newTopics.length} new topics`);
      return {
        generated: newTopics.length,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error("Error generating topics:", error);
      throw error;
    }
  }

  private async getRelevantTopics(count: number): Promise<TopicData[]> {
    const topicCache: TopicCache = await this.cache.get(this.TOPIC_CACHE_KEY);
    if (!topicCache) {
      throw new Error("No topics available");
    }

    // Weight topics by relevance and recency
    const weightedTopics = topicCache.topics.map((topic) => ({
      ...topic,
      weight:
        topic.relevance * (1 / (1 + (Date.now() - topic.lastUsed) / 86400000))
    }));

    // Sort by weight and take top count
    return weightedTopics.sort((a, b) => b.weight - a.weight).slice(0, count);
  }

  private async postTweet(content: string): Promise<{
    status: string;
    timestamp: number;
    content: string;
    reason?: string;
  }> {
    try {
      const timeSinceLastTweet = Date.now() - this.lastTweetTime;
      if (timeSinceLastTweet < this.config.minInterval) {
        return {
          status: "skipped",
          timestamp: Date.now(),
          content,
          reason: "Too soon since last tweet"
        };
      }

      // Send to Twitter
      await this.client.sendTweet(content);
      this.lastTweetTime = Date.now();

      return {
        status: "sent",
        timestamp: this.lastTweetTime,
        content
      };
    } catch (error) {
      console.error("Error posting tweet:", error);
      throw error;
    }
  }

  private async generateAndPostTweet(topics: string[]): Promise<{
    status: string;
    tweetId?: string;
    topics: string[];
    reason?: string;
    timestamp?: number;
    content?: string;
  }> {
    try {
      const timeSinceLastTweet = Date.now() - this.lastTweetTime;
      if (timeSinceLastTweet < this.config.minInterval) {
        return {
          status: "skipped",
          topics,
          reason: "Too soon since last tweet"
        };
      }

      // Generate tweet content using agent
      const contentMessage: Message = {
        id: crypto.randomUUID(),
        content: `Generate a tweet about: ${topics.join(", ")}. 
          Make it engaging and informative. Use the QUERY plugin first.
          Output only the Tweet content, do not call the POST_CONTENT maximum 280 characters. Reminder never use hashtags or emojis in the Twitter post content.`,
        author: "system",
        createdAt: new Date().toISOString(),
        source: "automated",
        type: "event",
        metadata: {
          type: "tweet_generation",
          topics,
          requiresProcessing: true
        }
      };

      const response = await this.context.agentService.handleMessage(
        contentMessage,
        {
          postSystemPrompt: `You can decide not to tweet by responding with "NO_RESPONSE".
          
          # Example Post Response Style:

          ${this.context.stateService
            .getRandomElements(
              this.context.stateService.getCharacter().postExamples,
              5
            )
            .map((ex) => `> ${ex}`)
            .join("\n")}
          ` // Add post response examples
        }
      );

      if (response.content.includes("NO_RESPONSE")) {
        return {
          status: "skipped",
          topics,
          reason: "Agent chose not to respond"
        };
      }

      // Send to Twitter
      await this.client.sendTweet(response.content);
      this.lastTweetTime = Date.now();

      // Update topic usage
      const topicCache: TopicCache = await this.cache.get(this.TOPIC_CACHE_KEY);
      if (topicCache) {
        topicCache.topics = topicCache.topics.map((topic) => {
          if (topics.includes(topic.topic)) {
            return {
              ...topic,
              lastUsed: Date.now(),
              relevance: topic.relevance * 1.1 // Boost relevance when used
            };
          }
          return topic;
        });
        await this.cache.set(this.TOPIC_CACHE_KEY, topicCache);
      }

      return {
        status: "sent",
        topics,
        content: response.content,
        timestamp: this.lastTweetTime
      };
    } catch (error) {
      console.error("Error generating and posting tweet:", error);
      throw error;
    }
  }
}
