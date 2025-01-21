// src/clients/twitter.client.ts

import { Scraper, SearchMode, Tweet } from "agent-twitter-client";
import { PluginContext } from "../../services/plugins/types";
import { Message } from "../../types/message.types";
import debug from "debug";
export type { Tweet } from "agent-twitter-client";

const log = debug("arok:twitter");

interface TwitterCookie {
  key: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
}

export class TwitterClient {
  private static instance: TwitterClient;
  private scraper: Scraper;
  private messageBus: PluginContext["messageBus"];
  private cache!: PluginContext["cacheService"];
  private isInitialized: boolean = false;
  private processedTweets: Set<string> = new Set();
  private readonly SESSION_CACHE_KEY = "twitter_session";
  private readonly SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

  private constructor(context: PluginContext) {
    this.scraper = new Scraper();
    this.messageBus = context.messageBus;
    this.cache = context.cacheService;

    // Subscribe to outgoing messages that need to be sent to Twitter
  }

  public static getInstance(context: PluginContext): TwitterClient {
    if (!TwitterClient.instance) {
      TwitterClient.instance = new TwitterClient(context);
      TwitterClient.instance.initialize();
    }
    return TwitterClient.instance;
  }

  getScraper(): Scraper {
    return this.scraper;
  }

  getMessageBus(): PluginContext["messageBus"] {
    return this.messageBus;
  }

  private async setCookiesFromArray(cookiesArray: TwitterCookie[]) {
    const cookieStrings = cookiesArray.map(
      (cookie) =>
        `${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}; ${
          cookie.secure ? "Secure" : ""
        }; ${cookie.httpOnly ? "HttpOnly" : ""}; SameSite=${
          cookie.sameSite || "Lax"
        }`
    );
    await this.scraper.setCookies(cookieStrings);
  }

  private async loadSession(): Promise<boolean> {
    try {
      const session = (await this.cache.get(this.SESSION_CACHE_KEY)) as {
        cookies: TwitterCookie[];
        expiresAt: number;
      } | null;

      if (!session || !session.cookies?.length) {
        log("No cached session found");
        return false;
      }

      if (Date.now() > session.expiresAt) {
        log("Cached session expired");
        await this.cache.set(this.SESSION_CACHE_KEY, null);
        return false;
      }

      log("Restoring session from cache...");
      await this.setCookiesFromArray(session.cookies);
      log("Restored session from cache");
      return true;
    } catch (error) {
      console.error("Error loading session:", error);
      return false;
    }
  }

  private async saveSession(): Promise<void> {
    try {
      const cookies = await this.scraper.getCookies();
      let cookiesArray = Array.isArray(cookies) ? cookies : JSON.parse(cookies);

      // Ensure cookies are plain objects
      cookiesArray = cookiesArray.map((cookie: any) => ({
        key: String(cookie.key || cookie.name),
        value: String(cookie.value),
        domain: String(cookie.domain),
        path: String(cookie.path || "/"),
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: String(cookie.sameSite || "Lax")
      }));

      const session = {
        cookies: cookiesArray,
        expiresAt: Date.now() + this.SESSION_EXPIRY
      };

      // Verify serializable
      JSON.parse(JSON.stringify(session));

      await this.cache.set(this.SESSION_CACHE_KEY, session, {
        type: "session",
        username: process.env.PLUGIN_TWITTER_USERNAME,
        createdAt: Date.now()
      });

      log("Saved session to cache");
    } catch (error) {
      console.error("Error saving session:", error);
      throw error;
    }
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Try to restore session
      const hasValidSession = await this.loadSession();
      let isLoggedIn = hasValidSession && (await this.scraper.isLoggedIn());

      // Login if needed
      if (!isLoggedIn) {
        log("Performing fresh login");
        await this.scraper.clearCookies();
        await this.scraper.login(
          process.env.PLUGIN_TWITTER_USERNAME!,
          process.env.PLUGIN_TWITTER_PASSWORD!,
          process.env.PLUGIN_TWITTER_EMAIL!,
          process.env.PLUGIN_TWITTER_2FA_SECRET!,
          process.env.PLUGIN_TWITTER_API_KEY!,
          process.env.PLUGIN_TWITTER_API_SECRET_KEY!,
          process.env.PLUGIN_TWITTER_ACCESS_TOKEN!,
          process.env.PLUGIN_TWITTER_ACCESS_TOKEN_SECRET!
        );
        // Cache the new session
        await this.saveSession();
      }

      // Initialize cache state
      await this.initializeCache();

      log("Twitter client initialized");
      this.isInitialized = true;
    } catch (error) {
      console.error("Failed to initialize Twitter client:", error);
      throw error;
    }
  }

  private async initializeCache() {
    // Restore cache state
    const lastMentionId = await this.cache.get("lastMentionId");
    const processedTweets = (await this.cache.get("processedTweets")) || [];

    if (processedTweets.length > 0) {
      this.processedTweets = new Set(processedTweets);
    }

    // Update cache metadata
    await this.cache.set(
      "twitter_state",
      {
        lastMentionId,
        lastPollTime: Date.now(),
        processedTweets: Array.from(this.processedTweets)
      },
      {
        type: "twitter_state",
        username: process.env.PLUGIN_TWITTER_USERNAME
      }
    );
  }

  public async handleOutgoingMessage(message: Message) {
    if (message.source !== "twitter" && !message.metadata?.requiresPosting) {
      return;
    }
    log("Sending tweet:", message.content);

    try {
      // Verify session before sending
      const isLoggedIn = await this.scraper.isLoggedIn();
      if (!isLoggedIn) {
        log("Session expired before sending tweet, reinitializing...");
        this.isInitialized = false;
        await this.initialize();
      }

      await this.scraper.sendTweet(
        message.content,
        message?.metadata?.replyToId
      );

      this.messageBus.publish({
        ...message,
        source: "twitter",
        metadata: {
          ...message.metadata,
          sent: true
        }
      });
    } catch (error) {
      console.error("Error sending tweet:", error);
      throw error;
    }
  }

  async searchTweets(
    query: string,
    count: number = 10,
    mode: SearchMode = SearchMode.Latest
  ): Promise<Tweet[]> {
    await this.validateSession();
    try {
      const tweets: Tweet[] = [];
      for await (const tweet of this.scraper.searchTweets(query, count, mode)) {
        tweets.push(tweet);
      }

      return tweets;
    } catch (error) {
      console.error("Error searching tweets:", error);
      return [];
    }
  }

  async sendTweet(content: string, replyToId?: string): Promise<boolean> {
    await this.validateSession();
    try {
      await this.scraper.sendTweet(content, replyToId);
      return true;
    } catch (error) {
      console.error("Error sending tweet:", error);
      // @ts-ignore
      console.error(error?.response?.data);
      throw error;
    }
  }

  async getTweet(tweetId: string): Promise<Tweet | null> {
    await this.validateSession();
    try {
      const tweet = await this.scraper.getTweet(tweetId);
      return tweet;
    } catch (error) {
      console.error("Error getting tweet:", error);
      return null;
    }
  }

  private async validateSession(): Promise<void> {
    const isLoggedIn = await this.scraper.isLoggedIn();
    if (!isLoggedIn) {
      log("Session expired, reinitializing...");
      this.isInitialized = false;
      await this.initialize();
    }
  }

  extractTweetId(text: string): string {
    const match = text.match(/twitter\.com\/\w+\/status\/(\d+)/);
    return match ? match[1] : "";
  }

  tweetToMessage(tweet: Tweet): Message {
    return {
      id: `${tweet.id}`,
      content:
        `Twitter mention from ${tweet.username} at ${tweet.timeParsed}: ${tweet.text}` ||
        "",
      author: tweet.userId || "",
      createdAt: tweet?.timestamp
        ? new Date(+tweet?.timestamp).toISOString()
        : new Date().toISOString(),
      source: "twitter",
      type: "request",
      requestId: tweet.conversationId,
      metadata: {
        name: tweet.name,
        username: tweet.username,
        isReply: !!tweet.isReply,
        replyToId: tweet.conversationId,
        mentions: tweet.mentions,
        hashtags: tweet.hashtags
      }
    };
  }
}
