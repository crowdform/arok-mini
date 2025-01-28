import { Bot, Context, SessionFlavor, session } from "grammy";
import {
  ExtendedPlugin,
  PluginContext,
  PluginMetadata,
  PluginAction
} from "../../services/plugins/types";
import { Message } from "../../types/message.types";
import debug from "debug";
import { set } from "lodash";

const log = debug("arok:plugin:telegram");

interface TelegramSession {
  isAdmin: boolean;
  userId: string;
  messageCount: number;
}

type TelegramContext = Context & SessionFlavor<TelegramSession>;

interface TelegramConfig {
  botToken: string;
  adminIds: string[];
  adminCommands: string[];
}

export class TelegramPlugin implements ExtendedPlugin {
  private bot: Bot<TelegramContext>;
  private context!: PluginContext;
  private readonly config: TelegramConfig;
  private isInitialized: boolean = false;
  private retryCount: number = 0;

  metadata: PluginMetadata = {
    name: "telegram",
    description: "Telegram bot integration for AROK",
    version: "1.0.0",
    callable: false,
    actions: {
      SEND_MESSAGE: {
        description: "Send a message to a Telegram user",
        schema: {
          type: "object",
          properties: {
            chatId: {
              type: "string",
              description: "Telegram chat ID"
            },
            content: {
              type: "string",
              description: "Message content"
            }
          },
          required: ["chatId", "content"]
        },
        examples: [
          {
            input: { chatId: "123456", content: "Hello from AROK!" },
            output: { status: "sent", messageId: "789" }
          }
        ]
      },
      BROADCAST: {
        description: "Broadcast a message to all admin users",
        scope: ["admin"],
        schema: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "Message to broadcast"
            }
          },
          required: ["content"]
        },
        examples: [
          {
            input: { content: "Important update!" },
            output: { status: "sent", recipientCount: 5 }
          }
        ]
      }
    }
  };

  constructor() {
    // Load config from environment variables
    this.config = {
      botToken: process.env.PLUGIN_TELEGRAM_BOT_TOKEN!,
      adminIds: (process.env.PLUGIN_TELEGRAM_ADMIN_IDS || "").split(","),
      adminCommands: ["stats", "broadcast", "query", "post", "system"]
    };

    if (!this.config.botToken) {
      console.warn("Telegram bot token not found in environment variables");

      throw new Error(
        "PLUGIN_TELEGRAM_BOT_TOKEN environment variable is required"
      );
    }

    // Initialize bot
    this.bot = new Bot<TelegramContext>(this.config.botToken);

    // Set up session middleware
    this.bot.use(
      session({
        initial: (): TelegramSession => ({
          isAdmin: false,
          userId: "",
          messageCount: 0
        })
      })
    );
  }

  private setupCommandHandlers() {
    // Start command
    this.bot.command("start", async (ctx) => {
      const userId = ctx.from?.id.toString();
      if (!userId) return;

      ctx.session.userId = userId;
      ctx.session.isAdmin = this.config.adminIds.includes(userId);

      const welcomeMessage = ctx.session.isAdmin
        ? "Welcome admin! You have access to additional commands."
        : "Welcome to AROK! How can I help you today?";

      await ctx.reply(welcomeMessage);
    });

    // Help command
    this.bot.command("help", async (ctx) => {
      let helpText =
        "Available commands:\n/start - Start the bot\n/help - Show this help";

      if (ctx.session.isAdmin) {
        helpText +=
          "\n\nAdmin commands:\n" +
          this.config.adminCommands.map((cmd) => `/${cmd}`).join("\n");
      }

      await ctx.reply(helpText);
    });

    // Admin commands
    if (this.config.adminCommands.includes("stats")) {
      this.bot.command(
        "stats",
        this.requireAdmin(async (ctx) => {
          const stats = await this.getStats();
          await ctx.reply(`System Stats:\n${JSON.stringify(stats, null, 2)}`);
        })
      );
    }

    if (this.config.adminCommands.includes("broadcast")) {
      this.bot.command(
        "broadcast",
        this.requireAdmin(async (ctx: TelegramContext) => {
          const message = ctx.match;
          if (!message) {
            await ctx.reply("Please provide a message to broadcast");
            return;
          }
          // @ts-ignore
          await this.broadcastToAdmins(message);
        })
      );
    }

    // Handle regular messages
    this.bot.on("message:text", async (ctx) => {
      const userId = ctx.from?.id.toString();
      if (!userId) return;

      ctx.session.userId = userId;
      ctx.session.isAdmin = this.config.adminIds.includes(userId);

      ctx.session.messageCount++;

      const message: Message = {
        id: crypto.randomUUID(),
        content: ctx.message.text,
        author: ctx.session.userId,
        type: "request",
        source: "telegram",
        createdAt: new Date().toISOString(),
        metadata: {
          platform: "telegram",
          chatId: ctx.chat.id.toString(),
          isAdmin: ctx.session.isAdmin
        }
      };

      try {
        const response = await this.context.agentService.handleMessage(message);
        await ctx.reply(response.content);
      } catch (error) {
        console.error("Error handling message:", error);
        await ctx.reply(
          "Sorry, I encountered an error processing your message."
        );
      }
    });
  }

  private requireAdmin(handler: (ctx: TelegramContext) => Promise<void>) {
    return async (ctx: TelegramContext) => {
      if (!ctx.session.isAdmin) {
        await ctx.reply("This command is only available to administrators.");
        return;
      }
      await handler(ctx);
    };
  }

  private async getStats() {
    // Implement stats collection logic
    return {
      activeUsers:
        (await this.context.cacheService.get("telegram:active_users")) || 0,
      messageCount:
        (await this.context.cacheService.get("telegram:message_count")) || 0,
      uptime: process.uptime()
    };
  }

  private async broadcastToAdmins(content: string) {
    const results = await Promise.allSettled(
      this.config.adminIds.map((adminId) =>
        this.bot.api.sendMessage(adminId, content)
      )
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    return { sent, total: this.config.adminIds.length };
  }

  actions = {
    SEND_MESSAGE: {
      execute: async (data: { chatId: string; content: string }) => {
        try {
          const result = await this.bot.api.sendMessage(
            data.chatId,
            data.content
          );
          return {
            status: "sent",
            messageId: result.message_id.toString()
          };
        } catch (error) {
          console.error("Error sending Telegram message:", error);
          throw error;
        }
      }
    },
    BROADCAST: {
      execute: async (data: { content: string }) => {
        return this.broadcastToAdmins(data.content);
      }
    }
  };

  async initialize(context: PluginContext): Promise<void> {
    if (this.isInitialized) return;

    this.context = context;
    this.setupCommandHandlers();

    try {
      await this.bot.api.setMyCommands([
        { command: "start", description: "Start the bot" },
        { command: "help", description: "Show help" },
        ...this.config.adminCommands.map((cmd) => ({
          command: cmd,
          description: `Admin: ${cmd}`
        }))
      ]);

      log("Telegram plugin initialized");
    } catch (error) {
      console.error("Error initializing Telegram plugin:", error);
      throw error;
    }
  }

  start(): Promise<void> | void {
    this.retryCount = 0;
    try {
      if (!this.isInitialized) {
        // Start the bot
        this.bot.start({
          onStart: () => {
            log("Telegram bot started");
            this.isInitialized = true;
          }
        });
        this.isInitialized = true;
        log("Telegram plugin started");

        this.bot.catch((error) => {
          console.error("Telegram bot error:", error);
        });
      }
    } catch (error) {
      this.retryCount++;
      if (this.retryCount < 5) {
        setTimeout(() => {
          console.log(
            "Retrying to start Telegram bot... count: ",
            this.retryCount
          );
          this.initialize(this.context);
        }, 5000 * this.retryCount);
      } else {
        console.error("Failed to start Telegram bot:");
        console.error(error);
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.isInitialized) {
      await this.bot.stop();
      this.isInitialized = false;
      log("Telegram plugin shut down");
    }
  }
}
