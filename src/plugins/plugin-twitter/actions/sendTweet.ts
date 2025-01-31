import { Action } from "../../../services/plugins/types";
import { TwitterClient } from "../twitter.client";
import { z } from "zod";

const sendTweetAction: Action<TwitterClient> = {
  name: "SEND_TWEET",
  similes: [
    "post tweet",
    "tweet",
    "post message",
    "send message",
    "write tweet",
    "compose tweet",
    "post update",
    "post content",
    "reply to tweet",
    "respond to tweet"
  ],
  description: "Send a new tweet or reply to an existing tweet",
  examples: [
    [
      {
        input: {
          content: "Just deployed a new smart contract on Solana!"
        },
        output: {
          status: "success",
          data: {
            tweetId: "1234567890123456789"
          }
        },
        explanation: "Send a new tweet"
      }
    ],
    [
      {
        input: {
          content: "This looks promising!",
          replyTo: "9876543210987654321"
        },
        output: {
          status: "success",
          data: {
            tweetId: "5432109876543210",
            inReplyTo: "9876543210987654321"
          }
        },
        explanation: "Reply to an existing tweet"
      }
    ]
  ],
  schema: z.object({
    content: z
      .string()
      .min(1)
      .max(280)
      .describe(
        "The tweet content to post, max 280 characters, no hashtags or try @mentions people related to the tweet (only if you know correct handle)"
      ),
    replyTo: z
      .string()
      .optional()
      .describe(
        "Optional ID of tweet to reply to | leave empty to post a new tweet"
      )
    // mediaFiles: z
    //   .array(z.any())
    //   .optional()
    //   .describe("Optional array of media files to attach")
  }),
  handler: async (twitterClient: TwitterClient, input: Record<string, any>) => {
    const stripHashtags = (text: string) => {
      return text.replace(/#\w+\s*/g, "").trim();
    };
    try {
      const {
        content,
        replyTo
        //mediaFiles
      } = input;

      const result = await twitterClient.scraper.sendTweet(
        stripHashtags(content),
        replyTo
      );

      return {
        status: "success",
        data: {
          tweetId: result
        }
      };
    } catch (error: any) {
      return {
        status: "error",
        message: `Failed to send tweet: ${error.message}`
      };
    }
  }
};

export default sendTweetAction;
