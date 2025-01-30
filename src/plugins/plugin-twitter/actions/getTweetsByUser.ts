import { Action } from "../../../services/plugins/types";
import { TwitterClient } from "../twitter.client";
import { z } from "zod";

import { Tweet } from "agent-twitter-client";

interface TweetMetrics {
  avgLikes: number;
  avgRetweets: number;
  avgReplies: number;
  avgViews: number;
  engagementRate: number;
  bestPerforming: {
    tweetId: string;
    likes: number;
    retweets: number;
    replies: number;
    views: number;
    text: string;
  };
  totalEngagement: {
    likes: number;
    retweets: number;
    replies: number;
    views: number;
  };
}

function calculateTweetMetrics(tweets: Tweet[]): TweetMetrics {
  let totalLikes = 0;
  let totalRetweets = 0;
  let totalReplies = 0;
  let totalViews = 0;
  let bestPerforming = tweets[0];

  // Calculate totals and find best performing tweet
  tweets.forEach((tweet) => {
    totalLikes += tweet.likes || 0;
    totalRetweets += tweet.retweets || 0;
    totalReplies += tweet.replies || 0;
    totalViews += tweet.views || 0;

    // Update best performing based on total engagement
    const currentEngagement =
      (tweet.likes || 0) + (tweet.retweets || 0) + (tweet.replies || 0);
    const bestEngagement =
      (bestPerforming.likes || 0) +
      (bestPerforming.retweets || 0) +
      (bestPerforming.replies || 0);

    if (currentEngagement > bestEngagement) {
      bestPerforming = tweet;
    }
  });

  const tweetCount = tweets.length;
  const avgLikes = totalLikes / tweetCount;
  const avgRetweets = totalRetweets / tweetCount;
  const avgReplies = totalReplies / tweetCount;
  const avgViews = totalViews / tweetCount;

  // Calculate engagement rate (total engagements / total impressions)
  const engagementRate =
    totalViews > 0
      ? (totalLikes + totalRetweets + totalReplies) / totalViews
      : 0;

  return {
    avgLikes,
    avgRetweets,
    avgReplies,
    avgViews,
    engagementRate,
    bestPerforming: {
      tweetId: bestPerforming.id!,
      likes: bestPerforming.likes || 0,
      retweets: bestPerforming.retweets || 0,
      replies: bestPerforming.replies || 0,
      views: bestPerforming.views || 0,
      text: bestPerforming.text || ""
    },
    totalEngagement: {
      likes: totalLikes,
      retweets: totalRetweets,
      replies: totalReplies,
      views: totalViews
    }
  };
}

const getTweetsAction: Action<TwitterClient> = {
  name: "GET_TWEETS",
  similes: [
    "fetch tweets",
    "get user tweets",
    "show tweets",
    "view tweets",
    "list tweets",
    "check tweets",
    "analyze tweets",
    "get posts",
    "fetch timeline",
    "tweet performance",
    "tweet analytics",
    "engagement stats",
    "tweet metrics"
  ],
  description: "Get tweets from a user and analyze engagement metrics",
  examples: [
    [
      {
        input: {
          username: "elonmusk",
          count: 10
        },
        output: {
          status: "success",
          data: {
            tweets: [
              /* array of tweets */
            ],
            metrics: {
              avgLikes: 50000,
              avgRetweets: 5000,
              avgReplies: 2000,
              avgViews: 1000000,
              engagementRate: 0.05,
              bestPerforming: {
                tweetId: "123...",
                likes: 100000,
                retweets: 10000,
                replies: 5000,
                views: 2000000,
                text: "Sample tweet text"
              }
            }
          }
        },
        explanation: "Get and analyze recent tweets from a user"
      }
    ],
    [
      {
        input: {
          count: 5,
          includeReplies: true
        },
        output: {
          status: "success",
          data: {
            tweets: [
              /* array of tweets */
            ],
            metrics: {
              avgLikes: 100,
              avgRetweets: 20,
              avgReplies: 10,
              avgViews: 1000,
              engagementRate: 0.02,
              bestPerforming: {
                tweetId: "123...",
                likes: 500,
                retweets: 50,
                replies: 20,
                views: 5000,
                text: "Sample tweet text"
              }
            }
          }
        },
        explanation: "Get own tweets including replies with metrics"
      }
    ]
  ],
  schema: z.object({
    username: z
      .string()
      .optional()
      .describe("Twitter username to fetch from (omit for own tweets)"),
    count: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Number of tweets to fetch"),
    includeReplies: z
      .boolean()
      .default(false)
      .describe("Whether to include replies in the result")
  }),
  handler: async (twitterClient: TwitterClient, input: Record<string, any>) => {
    try {
      const { username, count, includeReplies } = input;
      let tweets: Tweet[] = [];

      if (username) {
        if (includeReplies) {
          const iterator = twitterClient.scraper.getTweetsAndReplies(username);
          for await (const tweet of iterator) {
            tweets.push(tweet);
            if (tweets.length >= count) break;
          }
        } else {
          const iterator = twitterClient.scraper.getTweets(username);
          for await (const tweet of iterator) {
            tweets.push(tweet);
            if (tweets.length >= count) break;
          }
        }
      } else {
        // Get own tweets
        const profile = await twitterClient.scraper.me();
        if (!profile) throw new Error("Could not fetch own profile");

        if (includeReplies) {
          const iterator = twitterClient.scraper.getTweetsAndReplies(
            // @ts-ignore
            profile.username
          );
          for await (const tweet of iterator) {
            tweets.push(tweet);
            if (tweets.length >= count) break;
          }
        } else {
          // @ts-ignore
          const iterator = twitterClient.scraper.getTweets(profile.username);
          for await (const tweet of iterator) {
            tweets.push(tweet);
            if (tweets.length >= count) break;
          }
        }
      }

      // Calculate metrics for the tweets
      const metrics = calculateTweetMetrics(tweets);

      return {
        status: "success",
        data: {
          tweets,
          metrics
        }
      };
    } catch (error: any) {
      return {
        status: "error",
        message: `Failed to fetch tweets: ${error.message}`
      };
    }
  }
};

export default getTweetsAction;
