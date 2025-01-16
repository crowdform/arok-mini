// src/plugins/plugin-twitter/replies.ts

import {
  PluginContext,
  PluginMetadata,
  PluginAction
} from "../../services/plugins/types";
import { TwitterAutomationPlugin, AutomationConfig } from "./base";
import { Message } from "../../types/message.types";
import { TwitterClient } from "./twitter.client";
import { sampleSize } from "lodash";
import debug from "debug";

const log = debug("arok:plugin:twitter-replies");

interface ReplyConfig extends AutomationConfig {
  maxRepliesPerRun: number;
  maxRepliesPerTweet: number;
  searchTermRotationInterval: number;
  minEngagementScore: number;
}

interface Tweet {
  id: string;
  content: string;
  author: string;
  engagement: number;
  timestamp: number;
}

export class TwitterRepliesPlugin extends TwitterAutomationPlugin {
  public activeSearchTerms: string[] = [];
  public lastSearchTermUpdate: number = 0;
  public processedTweets: Set<string> = new Set();

  metadata: PluginMetadata = {
    name: "twitter_replies_automation",
    description: "Automates finding and replying to relevant Twitter content",
    version: "1.0.0",
    callable: false,
    actions: {
      GENERATE_SEARCH_TERMS: {
        description: "Generate relevant search terms for Twitter content",
        schema: {
          type: "object",
          properties: {
            baseTopics: {
              type: "string",
              description: "Base topics to generate search terms from"
            }
          },
          required: ["baseTopics"]
        },
        examples: [
          {
            input: "Generate search terms for crypto trends",
            output: "Generated terms: ['defi innovation', 'web3 development']"
          }
        ]
      },
      FIND_AND_REPLY: {
        description: "Find and reply to relevant tweets",
        schema: {
          type: "object",
          properties: {
            searchTerms: {
              type: "array",
              items: { type: "string" },
              description: "Terms to search for"
            },
            maxReplies: {
              type: "number",
              description: "Maximum number of replies to generate"
            }
          },
          required: ["searchTerms", "maxReplies"]
        },
        examples: [
          {
            input: "Find and reply to tweets about DeFi",
            output: "Found and processed 5 relevant tweets"
          }
        ]
      }
    }
  };

  config: ReplyConfig = {
    enabled: true,
    schedule: "*/15 * * * *",
    maxRetries: 3,
    timeout: 30000,
    maxRepliesPerRun: 5,
    maxRepliesPerTweet: 1,
    searchTermRotationInterval: 4 * 60 * 60 * 1000,
    minEngagementScore: 0.6
  };

  actions: Record<string, PluginAction> = {
    GENERATE_SEARCH_TERMS: {
      execute: async (data: { baseTopics?: string }) => {
        return this.executeGenerateSearchTerms(data);
      }
    },
    FIND_AND_REPLY: {
      execute: async (data: { searchTerms: string[]; maxReplies: number }) => {
        return this.executeFindAndReply(data);
      }
    }
  };

  async initialize(context: PluginContext): Promise<void> {
    await super.initialize(context);
    this.client = TwitterClient.getInstance(this.context);
    log("Twitter replies plugin initialized");
  }

  private async executeGenerateSearchTerms(data: {
    baseTopics?: string;
  }): Promise<any> {
    try {
      const timeSinceLastUpdate = Date.now() - this.lastSearchTermUpdate;
      if (timeSinceLastUpdate < this.config.searchTermRotationInterval) {
        return { searchTerms: this.activeSearchTerms };
      }

      const baseTopics =
        data.baseTopics ||
        sampleSize(this.context.stateService.getCharacter().topics, 5).join(
          ", "
        );
      const queryPrompt = `Generate strategic search terms for Twitter engagement based on topics: ${baseTopics}. DO NOT CALL GENERATE_SEARCH_TERMS but reply directly with the generated terms.`;

      const result = await this.queryPlugin(queryPrompt, {
        type: "search_term_generation"
      });

      this.activeSearchTerms = result
        .split(",")
        .map((term: string) => term.trim());
      this.lastSearchTermUpdate = Date.now();
      log("Generated search terms:", this.activeSearchTerms);

      return {
        searchTerms: this.activeSearchTerms,
        timestamp: this.lastSearchTermUpdate
      };
    } catch (error) {
      console.error("Error generating search terms:", error);
      throw error;
    }
  }

  private async executeFindAndReply(data: {
    searchTerms: string[];
    maxReplies: number;
  }): Promise<any> {
    try {
      let repliesGenerated = 0;
      const processedThisRun: string[] = [];

      for (const term of data.searchTerms) {
        if (repliesGenerated >= data.maxReplies) break;

        const searchMessage: Message = {
          id: crypto.randomUUID(),
          content: `SEARCH_TWEETS: ${term}`,
          author: "system",
          createdAt: new Date().toISOString(),
          source: "automated",
          metadata: {
            type: "twitter_search",
            searchTerm: term,
            requiresProcessing: true
          }
        };

        await this.context.messageBus.publish(searchMessage);
        const searchResponse = await this.waitForAgentResponse(
          searchMessage.id
        );
        const tweets: Tweet[] = JSON.parse(searchResponse.content).tweets || [];

        const relevantTweets = tweets
          .filter(
            (tweet) =>
              !this.processedTweets.has(tweet.id) &&
              tweet.engagement >= this.config.minEngagementScore
          )
          .sort((a, b) => b.engagement - a.engagement);

        for (const tweet of relevantTweets) {
          if (repliesGenerated >= data.maxReplies) break;

          const analysisMessage: Message = {
            id: crypto.randomUUID(),
            content: `ANALYZE_TWEET: ${tweet.content}`,
            author: "system",
            createdAt: new Date().toISOString(),
            source: "automated",
            metadata: {
              type: "tweet_analysis",
              tweet,
              requiresProcessing: true
            }
          };

          await this.context.messageBus.publish(analysisMessage);
          const analysisResponse = await this.waitForAgentResponse(
            analysisMessage.id
          );
          const analysis = JSON.parse(analysisResponse.content);

          await this.sendToTwitter(analysis.reply, tweet.id, {
            originalTweet: tweet,
            analysis,
            searchTerm: term,
            replyType: "automated"
          });

          repliesGenerated++;
          this.processedTweets.add(tweet.id);
          processedThisRun.push(tweet.id);

          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      if (this.processedTweets.size > 1000) {
        const tweetsArray = Array.from(this.processedTweets);
        const toRemove = tweetsArray.slice(0, tweetsArray.length - 1000);
        toRemove.forEach((tweetId) => this.processedTweets.delete(tweetId));
      }

      return {
        status: "completed",
        repliesGenerated,
        processedTweets: processedThisRun,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error("Error in find and reply:", error);
      throw error;
    }
  }

  protected async startAutomation(): Promise<void> {
    log("Started reply automation");

    await this.context.schedulerService.registerJob({
      id: "twitter:generate-replies",
      schedule: this.config.schedule, // Every 15 minutes
      handler: async () => {
        try {
          const { searchTerms } = await this.executeGenerateSearchTerms({});
          log("Generated search terms:", searchTerms);
          return this.executeFindAndReply({
            searchTerms,
            maxReplies: this.config.maxRepliesPerRun
          });
        } catch (error) {
          console.error("Error in reply automation cycle:", error);
        }
      },
      metadata: {
        plugin: this.metadata.name,
        description: this.metadata.description
      }
    });
  }
}
