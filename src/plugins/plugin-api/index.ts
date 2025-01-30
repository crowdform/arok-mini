// src/plugins/plugin-api/index.ts

import {
  ExtendedPlugin,
  PluginContext,
  PluginMetadata
} from "../../services/plugins/types";
import { Message, ROUTING_PATTERNS } from "../../types/message.types";
import express, { Request, Response } from "express";
import debug from "debug";

const log = debug("arok:plugin:api");

interface APIMessage {
  content: string;
  userId?: string;
  requestId?: string;
  metadata?: Record<string, any>;
}

interface EventMessage {
  [key: string]: any;
}

interface APIPluginConfig {
  app: express.Application;
}

export class APIPlugin implements ExtendedPlugin {
  private app: express.Application;
  private context!: PluginContext;

  constructor(config: APIPluginConfig) {
    this.app = config.app;
  }
  private pendingResponses: Map<string, Response> = new Map();
  private responseTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private isInitialized: boolean = false;
  private readonly RESPONSE_TIMEOUT = 30000;

  metadata: PluginMetadata = {
    name: "api",
    description: "Handles HTTP API interactions",
    version: "1.0.0",
    callable: false,
    actions: {
      SEND_API_RESPONSE: {
        description: "Send a response to an API request",
        schema: {
          type: "object",
          properties: {
            responseId: {
              type: "string",
              description: "ID of the pending response",
              required: true
            },
            content: {
              type: "string",
              description: "Response content",
              required: true
            }
          },
          required: ["responseId", "content"]
        },
        examples: [
          {
            input: "Send API response",
            output: "Response sent successfully"
          }
        ]
      }
    }
  };

  actions = {
    SEND_API_RESPONSE: {
      execute: async (data: { responseId: string; content: string }) => {
        const res = this.pendingResponses.get(data.responseId);
        if (!res) {
          throw new Error("No pending response found");
        }

        try {
          res.json({
            status: "success",
            data: {
              content: data.content,
              timestamp: Date.now()
            }
          });

          return { status: "sent", responseId: data.responseId };
        } catch (error) {
          console.error("Error sending API response:", error);
          throw error;
        }
      }
    }
  };

  async initialize(context: PluginContext): Promise<void> {
    if (this.isInitialized) return;

    this.context = context;
    await this.setupRoutes();

    // If in serverless mode, set up heartbeat endpoint
    if (this.context.schedulerService.config.mode === "serverless") {
      this.setupHeartbeatEndpoint();
    }

    this.isInitialized = true;
    log("API plugin initialized");
  }
  private setupHeartbeatEndpoint(): void {
    this.app.get("/heartbeat", async (req, res) => {
      try {
        await this.context.schedulerService.triggerHeartbeat();
        const results = await this.context.schedulerService.processJobs();
        res.json(results);
      } catch (error) {
        console.error("Error processing heartbeat:", error);
        res.status(500).json({
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });

    log("Set up serverless heartbeat endpoint at /heartbeat");
  }

  private async setupRoutes() {
    this.app.use(express.json());
    // @ts-ignore
    this.app.post("/api/event", async (req: Request, res: Response) => {
      try {
        const apiMessage: EventMessage = req.body;

        const responseId = crypto.randomUUID();
        const message: Message = {
          id: crypto.randomUUID(),
          content:
            "#Notification Event:\n\n```json" +
            JSON.stringify(apiMessage) +
            "```" +
            `\n\n
            Given the above information, take the one main topic and generate and post content about it in the character style.
            Do not reply directly but MUST call tools and functions in-order to route this request to the correct function. Use SEND_TWEET mostly.
            `,
          author: apiMessage.userId || "agent",
          participants: [apiMessage.userId || "agent"],
          createdAt: new Date().toISOString(),
          type: "request",
          source: "api",
          requestId: responseId,
          metadata: {
            ...apiMessage.metadata,
            responseNeeded: true,
            responseId
          }
        };

        const responseMessage = await this.context.agentService.handleMessage(
          message,
          {
            postSystemPrompt: `\n   \n #Notification Events are incoming data, that you should determine how to handle. Always keep reply in character.
              \n
              # Example handling: \n
              If new content, news, market movement is detected, call SEND_TWEET function with content. \n 
              Do not repeat yourself so check the previous context for the last actions and posts.
              Do not reply directly but MUST call tools and functions in-order to route this request to the correct function. Use SEND_TWEET mostly.
              Focus on one topic from the notification event.
              Reminder never use hashtags or emojis in the post content.\n
            `
          }
        );
        res.json({
          status: "success",
          data: {
            messageId: responseMessage.id,
            content: responseMessage.content,
            createdAt: responseMessage.createdAt,
            metadata: responseMessage.metadata
          }
        });
      } catch (error) {
        console.error("Error processing API message:", error);
        res.status(500).json({
          status: "error",
          error: "Failed to process message"
        });
      }
    });
    // @ts-ignore
    this.app.post("/api/chat", async (req: Request, res: Response) => {
      try {
        const apiMessage: APIMessage = req.body;

        if (!apiMessage.content) {
          return res.status(400).json({
            status: "error",
            error: "Message content is required"
          });
        }

        const responseId = crypto.randomUUID();
        const message: Message = {
          id: crypto.randomUUID(),
          content: apiMessage.content,
          author: apiMessage.userId || "api-user",
          createdAt: new Date().toISOString(),
          participants: [apiMessage.userId || "api-user"],
          type: "request",
          source: "api",
          requestId: apiMessage.requestId,
          metadata: {
            ...apiMessage.metadata,
            responseNeeded: true,
            responseId
          }
        };

        const responseMessage =
          await this.context.agentService.handleMessage(message);
        res.json({
          status: "success",
          data: {
            messageId: responseMessage.id,
            content: responseMessage.content,
            createdAt: responseMessage.createdAt,
            metadata: responseMessage.metadata
          }
        });
      } catch (error) {
        console.error("Error processing API message:", error);
        res.status(500).json({
          status: "error",
          error: "Failed to process message"
        });
      }
    });
  }
}
