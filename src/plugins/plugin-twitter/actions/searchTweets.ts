import { Action } from "../../../services/plugins/types";
import { TwitterClient } from "../twitter.client";
import { z } from "zod";

import { SearchMode } from "agent-twitter-client";

const searchTweetsAction: Action = {
  name: "SEARCH_TWEETS",
  similes: [
    "find tweets",
    "search for tweets",
    "look for tweets",
    "find posts about",
    "search twitter for",
    "find mentions of",
    "search hashtag",
    "find $cashtag",
    "search tweets containing",
    "find recent tweets about"
  ],
  description: "Search for tweets using keywords, hashtags, or cashtags",
  examples: [
    [
      {
        input: {
          query: "#solana",
          count: 10,
          mode: "Latest"
        },
        output: {
          status: "success",
          data: {
            tweets: [
              /* array of tweet objects */
            ],
            nextCursor: "cursor-string"
          }
        },
        explanation: "Search for 10 latest tweets containing #solana"
      }
    ],
    [
      {
        input: {
          query: "$SOL",
          count: 5,
          mode: "Top"
        },
        output: {
          status: "success",
          data: {
            tweets: [
              /* array of tweet objects */
            ]
          }
        },
        explanation: "Search for top 5 tweets mentioning $SOL"
      }
    ]
  ],
  schema: z.object({
    query: z
      .string()
      .min(1)
      .max(500)
      .describe("The search query (can include hashtags, cashtags, keywords)"),
    count: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Number of tweets to fetch"),
    mode: z
      .enum(["Latest", "Top", "People", "Media"])
      .default("Latest")
      .describe("Search mode (Latest, Top, People, or Media)")
  }),
  handler: async (twitterClient: TwitterClient, input: Record<string, any>) => {
    try {
      const { query, count, mode } = input;
      const searchMode = SearchMode[mode as keyof typeof SearchMode];

      const results = await twitterClient.scraper.fetchSearchTweets(
        query,
        count,
        searchMode
      );

      return {
        status: "success",
        data: {
          tweets: results.tweets,
          nextCursor: results.next
        }
      };
    } catch (error: any) {
      return {
        status: "error",
        message: `Failed to search tweets: ${error.message}`
      };
    }
  }
};

export default searchTweetsAction;
