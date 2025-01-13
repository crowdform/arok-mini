import {
  PluginMetadata,
  PluginAction,
  ActionExecutionContext
} from "../../services/plugins/types";
import { TwitterAutomationPlugin, AutomationConfig } from "./base";
import { Message } from "../../types/message.types";
import debug from "debug";
import { sampleSize } from "lodash";

const log = debug("arok:plugin:twitter-tweets");

interface TweetGenerationConfig extends AutomationConfig {
  topicsPerTweet: number;
  maxTweetsPerRun: number;
  minInterval: number;
  useTrendingTopics: boolean;
}

export class TwitterTweetsPlugin extends TwitterAutomationPlugin {
  metadata: PluginMetadata = {
    name: "twitter_tweets_automation",
    description: "Automates generating and posting Twitter content",
    version: "1.0.0",
    actions: {
      GENERATE_TWEET_TOPICS: {
        description: "Generate relevant topics for new tweets",
        schema: {
          type: "object",
          properties: {
            count: {
              type: "number",
              description: "Number of topics to generate"
            },
            includeTrending: {
              type: "boolean",
              description: "Whether to include trending topics"
            }
          }
        },
        examples: [
          {
            input: "Generate 3 tweet topics",
            output: "DeFi trends, NFT markets, Web3 gaming"
          }
        ]
      },
      GENERATE_AND_POST: {
        description: "Generate and post new tweets",
        schema: {
          type: "object",
          properties: {
            topics: {
              type: "array",
              items: { type: "string" },
              description: "Topics to tweet about"
            },
            style: {
              type: "string",
              enum: ["analysis", "news", "opinion"],
              description: "Style of the tweet"
            }
          }
        },
        examples: [
          {
            input: "Generate analysis tweet about DeFi trends",
            output: "Generated and queued tweet for posting"
          }
        ]
      }
    }
  };

  config: TweetGenerationConfig = {
    enabled: true,
    schedule: 72 * 60 * 1000, // 72 minutes
    maxRetries: 3,
    timeout: 30000,
    topicsPerTweet: 2,
    maxTweetsPerRun: 1,
    minInterval: 15 * 60 * 1000, // 15 minutes minimum between tweets
    useTrendingTopics: true
  };

  private lastTweetTime: number = 0;

  // Helper method to generate tweet topics
  private async generateTweetTopics(count: number, includeTrending: boolean) {
    try {
      const topics = sampleSize(
        this.context.stateService.getCharacter().topics,
        4
      );
      const queryPrompt = `Analyze current market trends and generate ${count} engaging tweet topics. 
        Include trending topics: ${includeTrending}. 
        Focus on: ${topics}. DO NOT CALL GENERATE_TWEET_TOPICS plugin, but output the topics directly.`;

      const result = await this.queryPlugin(queryPrompt, {
        type: "topic_generation"
      });

      log(`Generated ${result} tweet topics`);
      return { topics: result, timestamp: Date.now() };
    } catch (error) {
      console.error("Error generating tweet topics:", error);
      throw error;
    }
  }

  // Helper method to generate and post tweets
  private async generateAndPostTweet(topics: string, style: string) {
    try {
      const timeSinceLastTweet = Date.now() - this.lastTweetTime;
      if (timeSinceLastTweet < this.config.minInterval) {
        log("Skipping tweet generation - too soon since last tweet");
        return { status: "skipped", reason: "rate_limit" };
      }

      // Generate tweet content using agent
      const contentMessage: Message = {
        id: crypto.randomUUID(),
        content: `Generate a ${style} tweet about: ${topics}. 
          Make it engaging and informative while maintaining the character's voice. USE the KNOWLEDGE_QUERY (if available) plugin before answering. DO NOT CALL GENERATE_AND_POST plugin again but output.`,
        author: "system",
        createdAt: new Date().toISOString(),
        source: "automated",
        metadata: {
          type: "tweet_generation",
          topics,
          style,
          requiresProcessing: true
        }
      };

      await this.context.messageBus.publish(contentMessage);
      const response = await this.waitForAgentResponse(contentMessage.id);

      // Send generated content to Twitter
      await this.sendToTwitter(response.content, undefined, {
        topics,
        style,
        generationType: "automated"
      });

      this.lastTweetTime = Date.now();
      log(`Generated and sent tweet about ${topics}`);

      return {
        status: "sent",
        content: response.content,
        timestamp: this.lastTweetTime
      };
    } catch (error) {
      console.error("Error generating and posting tweet:", error);
      throw error;
    }
  }

  actions = {
    GENERATE_TWEET_TOPICS: {
      execute: async (
        data: { count: number; includeTrending: boolean },
        context?: ActionExecutionContext
      ) => {
        return this.generateTweetTopics(data.count, data.includeTrending);
      }
    },

    GENERATE_AND_POST: {
      execute: async (
        data: { topics: string; style: string },
        context?: ActionExecutionContext
      ) => {
        return this.generateAndPostTweet(data.topics, data.style);
      }
    }
  };

  protected async startAutomation(): Promise<void> {
    let count = 0;
    const mainLoop = async () => {
      try {
        count++;
        console.log("Tweet automation cycle:", count);
        // Generate topics
        const { topics } = await this.generateTweetTopics(
          this.config.topicsPerTweet,
          this.config.useTrendingTopics
        );

        // Generate and post tweets
        const styles = ["analysis", "news", "opinion"];
        const style = styles[Math.floor(Math.random() * styles.length)];
        console.log("Generated topics:", topics, style, count);
        await this.generateAndPostTweet(topics, style);
      } catch (error) {
        console.error("Error in tweet automation cycle:", error);
      }
    };

    log("Started tweet generation automation");
    await this.context.schedulerService.registerJob({
      id: "twitter:generate-tweets",
      schedule: this.config.schedule, // Every 72 minutes
      handler: async () => {
        return mainLoop();
      },
      metadata: {
        plugin: this.metadata.name,
        description: this.metadata.description
      }
    });
  }
}
