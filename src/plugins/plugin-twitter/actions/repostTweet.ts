import { Action } from "../../../services/plugins/types";
import { TwitterClient } from "../twitter.client";
import { z } from "zod";

const repostTweetAction: Action<TwitterClient> = {
  name: "REPOST_TWEET",
  similes: [
    "retweet",
    "repost",
    "share tweet",
    "boost tweet",
    "amplify tweet",
    "spread tweet",
    "pass along tweet",
    "forward tweet",
    "echo tweet",
    "rt tweet"
  ],
  description: "Repost (retweet) a tweet using its ID",
  examples: [
    [
      {
        input: {
          tweetId: "1234567890123456789"
        },
        output: {
          status: "success",
          data: {
            retweetId: "9876543210987654321"
          }
        },
        explanation: "Simple retweet of a tweet"
      }
    ],
    [
      {
        input: {
          tweetId: "1234567890123456789",
          quote: "Great insights on Solana!"
        },
        output: {
          status: "success",
          data: {
            retweetId: "9876543210987654321",
            quoteTweetId: "5432109876543210"
          }
        },
        explanation: "Quote tweet with additional comment"
      }
    ]
  ],
  schema: z.object({
    tweetId: z.string().min(1).describe("The ID of the tweet to repost"),
    quote: z
      .string()
      .max(280)
      .optional()
      .describe("Optional quote text to add to the retweet")
  }),
  handler: async (twitterClient: TwitterClient, input: Record<string, any>) => {
    try {
      const { tweetId, quote } = input;

      if (quote) {
        await twitterClient.scraper.sendQuoteTweet(quote, tweetId);
        return {
          status: "success",
          data: {
            retweetId: tweetId,
            quote: quote
          }
        };
      } else {
        await twitterClient.scraper.retweet(tweetId);
        return {
          status: "success",
          data: {
            retweetId: tweetId
          }
        };
      }
    } catch (error: any) {
      return {
        status: "error",
        message: `Failed to repost tweet: ${error.message}`
      };
    }
  }
};

export default repostTweetAction;
