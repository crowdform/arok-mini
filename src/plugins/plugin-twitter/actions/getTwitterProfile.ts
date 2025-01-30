import { Action } from "../../../services/plugins/types";
import { TwitterClient } from "../twitter.client";
import { z } from "zod";

const getProfileAction: Action<TwitterClient> = {
  name: "GET_PROFILE",
  similes: [
    "get user",
    "fetch profile",
    "lookup user",
    "find user",
    "check profile",
    "view profile",
    "show user",
    "get account",
    "profile info",
    "user details"
  ],
  description:
    "Get profile information for a Twitter user or the authenticated user",
  examples: [
    [
      {
        input: {
          username: "elonmusk"
        },
        output: {
          status: "success",
          data: {
            userId: "44196397",
            name: "Elon Musk",
            username: "elonmusk",
            description: "...",
            followers: 170000000,
            following: 1234,
            tweets: 12345
          }
        },
        explanation: "Get profile of a specific user"
      }
    ],
    [
      {
        input: {},
        output: {
          status: "success",
          data: {
            userId: "123456789",
            name: "My Account",
            username: "myaccount",
            description: "...",
            followers: 1000,
            following: 500,
            tweets: 1234
          }
        },
        explanation: "Get authenticated user's profile"
      }
    ]
  ],
  schema: z.object({
    username: z
      .string()
      .optional()
      .describe("Twitter username to fetch (omit for own profile)")
  }),
  handler: async (twitterClient: TwitterClient, input: Record<string, any>) => {
    try {
      const { username } = input;
      const profile = username
        ? await twitterClient.scraper.getProfile(username)
        : await twitterClient.scraper.me();

      if (!profile) {
        throw new Error("Profile not found");
      }

      return {
        status: "success",
        data: {
          ...profile
        }
      };
    } catch (error: any) {
      return {
        status: "error",
        message: `Failed to get profile: ${error.message}`
      };
    }
  }
};

export default getProfileAction;
