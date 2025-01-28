import { Action } from "../../../services/plugins/types";
import { TwitterClient } from "../twitter.client";
import { z } from "zod";

import { Tweet } from "agent-twitter-client";

interface EngagementOpportunity {
  tweetId: string;
  username: string;
  type: "conversation" | "trending" | "mention" | "cashtag" | "hashtag";
  score: number;
  tweet: Tweet;
  reason: string;
}

const checkTimelineAction: Action = {
  name: "CHECK_TIMELINE",
  similes: [
    "fetch timeline",
    "get home feed",
    "check feed",
    "view timeline",
    "show feed",
    "get timeline",
    "fetch feed",
    "monitor timeline",
    "check home",
    "read timeline",
    "scan feed",
    "browse timeline"
  ],
  description:
    "Fetch and analyze the home timeline for relevant content and engagement opportunities",
  examples: [
    [
      {
        input: {
          count: 20,
          seenTweets: ["1234567890", "9876543210"]
        },
        output: {
          status: "success",
          data: {
            newTweets: [
              {
                id: "123456789",
                text: "Some tweet content",
                username: "user1",
                timestamp: "2025-01-28T12:00:00Z",
                metrics: {
                  likes: 100,
                  retweets: 50,
                  replies: 25
                }
              }
            ],
            opportunities: [
              {
                tweetId: "123456789",
                username: "user1",
                type: "trending",
                score: 0.85,
                reason: "High engagement trending topic"
              }
            ]
          }
        },
        explanation: "Fetch timeline and find engagement opportunities"
      }
    ]
  ],
  schema: z.object({
    count: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Number of tweets to fetch"),
    seenTweets: z
      .array(z.string())
      .optional()
      .describe("Array of previously seen tweet IDs to filter out")
  }),
  handler: async (twitterClient: TwitterClient, input: Record<string, any>) => {
    try {
      const { count, seenTweets = [] } = input;
      const seenTweetsSet = new Set(seenTweets);

      // Fetch timeline tweets
      const results = await twitterClient.scraper.fetchHomeTimeline(count);

      if (!results || !results.tweets) {
        throw new Error("Failed to fetch timeline");
      }

      // Filter out seen tweets and process new ones
      const newTweets = results.tweets.filter(
        (tweet) => tweet.id && !seenTweetsSet.has(tweet.id)
      );

      // Find engagement opportunities
      const opportunities: EngagementOpportunity[] = [];

      for (const tweet of newTweets) {
        const opportunity = analyzeEngagementOpportunity(tweet);
        if (opportunity) {
          opportunities.push(opportunity);
        }
      }

      // Sort opportunities by score
      opportunities.sort((a, b) => b.score - a.score);

      return {
        status: "success",
        data: {
          newTweets: newTweets.map((tweet) => ({
            id: tweet.id,
            text: tweet.text,
            username: tweet.username,
            timestamp: tweet.timeParsed,
            conversationId: tweet.conversationId,
            hashtags: tweet.hashtags,
            mentions: tweet.mentions,
            metrics: {
              likes: tweet.likes || 0,
              retweets: tweet.retweets || 0,
              replies: tweet.replies || 0,
              views: tweet.views || 0,
              quotes: tweet.quotes || 0
            },
            isReply: tweet.isReply,
            isRetweet: tweet.isRetweet,
            isQuote: tweet.isQuote
          })),
          opportunities: opportunities.map((opp) => ({
            tweetId: opp.tweetId,
            username: opp.username,
            type: opp.type,
            score: opp.score,
            reason: opp.reason
          })),
          cursor: results.next
        }
      };
    } catch (error: any) {
      return {
        status: "error",
        message: `Failed to check timeline: ${error.message}`
      };
    }
  }
};

function analyzeEngagementOpportunity(
  tweet: Tweet
): EngagementOpportunity | null {
  // Skip retweets
  if (tweet.isRetweet) return null;

  const score = calculateEngagementScore(tweet);
  if (score < 0.5) return null; // Skip low engagement opportunities

  let type: EngagementOpportunity["type"] = "conversation";
  let reason = "";

  // Determine opportunity type and reason
  if (tweet.hashtags?.some((tag) => isRelevantHashtag(tag))) {
    type = "hashtag";
    reason = "Relevant hashtag discussion";
  } else if (tweet.text?.includes("$") && isCryptoDiscussion(tweet.text)) {
    type = "cashtag";
    reason = "Crypto token discussion";
  } else if (tweet.mentions?.length && tweet.replies && tweet.replies > 5) {
    type = "conversation";
    reason = "Active discussion thread";
  } else if (isHighEngagement(tweet)) {
    type = "trending";
    reason = "High engagement post";
  } else if (tweet.mentions?.length) {
    type = "mention";
    reason = "Network interaction opportunity";
  }

  return {
    tweetId: tweet.id!,
    username: tweet.username!,
    type,
    score,
    tweet,
    reason
  };
}

function calculateEngagementScore(tweet: Tweet): number {
  if (!tweet.views) return 0;

  // Calculate base engagement rate
  const engagements =
    (tweet.likes || 0) + (tweet.retweets || 0) * 2 + (tweet.replies || 0) * 1.5;
  const engagementRate = engagements / tweet.views;

  // Time decay factor (24 hour window)
  const age = Date.now() - new Date(tweet.timeParsed || Date.now()).getTime();
  const timeDecay = Math.max(0, 1 - age / (24 * 60 * 60 * 1000));

  // Weighted score calculation
  return engagementRate * 0.7 + timeDecay * 0.3;
}

function isHighEngagement(tweet: Tweet): boolean {
  return (
    (tweet.likes || 0) > 100 ||
    (tweet.retweets || 0) > 50 ||
    (tweet.replies || 0) > 25
  );
}

function isRelevantHashtag(tag: string): boolean {
  const relevantTags = new Set([
    "solana",
    "crypto",
    "web3",
    "defi",
    "nft",
    "blockchain",
    "ai",
    "trading",
    "dao"
  ]);
  return relevantTags.has(tag.toLowerCase());
}

function isCryptoDiscussion(text: string): boolean {
  const cryptoKeywords = ["token", "coin", "crypto", "sol", "btc", "eth"];
  return cryptoKeywords.some((keyword) => text.toLowerCase().includes(keyword));
}

export default checkTimelineAction;
