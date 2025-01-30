import checkTimelineAction from "./checkTimeline";
import getTweetsByUserAction from "./getTweetsByUser";
import getTwitterProfileAction from "./getTwitterProfile";
import repostTweetAction from "./repostTweet";
import searchTweetsAction from "./searchTweets";
import sendTweetAction from "./sendTweet";

export const ACTIONS = {
  CHECK_TIMELINE: checkTimelineAction,
  GET_TWEETS_BY_USER: getTweetsByUserAction,
  GET_TWITTER_PROFILE: getTwitterProfileAction,
  REPOST_TWEET: repostTweetAction,
  SEARCH_TWEETS: searchTweetsAction,
  SEND_TWEET: sendTweetAction
} as const;

export type ActionType = keyof typeof ACTIONS;

// Re-export individual actions for direct imports
export {
  checkTimelineAction,
  getTweetsByUserAction,
  getTwitterProfileAction,
  repostTweetAction,
  searchTweetsAction,
  sendTweetAction
};
