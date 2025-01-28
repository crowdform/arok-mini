import { Action } from "../../../services/plugins/types";
import { TwitterClient } from "../twitter.client";
import { z } from "zod";

const sendTweetAction: Action = {
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
    content: z.string().min(1).max(280).describe("The tweet content to post"),
    replyTo: z.string().optional().describe("Optional ID of tweet to reply to"),
    mediaFiles: z
      .array(z.any())
      .optional()
      .describe("Optional array of media files to attach")
  }),
  handler: async (twitterClient: TwitterClient, input: Record<string, any>) => {
    try {
      const { content, replyTo, mediaFiles } = input;

      const result = await twitterClient.scraper.sendTweet(
        content,
        replyTo,
        mediaFiles
      );

      return {
        status: "success",
        data: {
          tweetId: result.tweetId,
          ...(replyTo && { inReplyTo: replyTo })
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
