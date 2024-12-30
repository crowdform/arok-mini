// src/plugins/plugin-api/index.ts

import {
  ExtendedPlugin,
  PluginContext,
  PluginMetadata
} from "../../services/plugins/types";
import { Message } from "../../types/message.types";
import express, { Request, Response } from "express";
import debug from "debug";

const log = debug("arok:plugin:api");

interface APIMessage {
  content: string;
  userId?: string;
  parentId?: string;
  metadata?: Record<string, any>;
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
          }
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

          this.cleanupResponse(data.responseId);
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

    // Subscribe to outgoing messages
    this.context.messageBus.subscribeToOutgoing(
      this.handleOutgoingMessage.bind(this)
    );

    this.isInitialized = true;
    log("API plugin initialized");
  }

  private async setupRoutes() {
    this.app.use(express.json());

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
          source: "api",
          parentId: apiMessage.parentId,
          metadata: {
            ...apiMessage.metadata,
            responseNeeded: true,
            responseId
          }
        };

        this.pendingResponses.set(responseId, res);

        const timeout = setTimeout(() => {
          this.handleResponseTimeout(responseId);
        }, this.RESPONSE_TIMEOUT);

        this.responseTimeouts.set(responseId, timeout);

        await this.context.messageBus.publish(message);
      } catch (error) {
        console.error("Error processing API message:", error);
        res.status(500).json({
          status: "error",
          error: "Failed to process message"
        });
      }
    });
  }

  private async handleOutgoingMessage(message: Message) {
    if (message.source !== "api") return;

    const responseId = message.metadata?.responseId;
    if (!responseId) return;

    const res = this.pendingResponses.get(responseId);
    if (!res) return;

    try {
      res.json({
        status: "success",
        data: {
          messageId: message.id,
          content: message.content,
          createdAt: message.createdAt,
          metadata: message.metadata
        }
      });
    } catch (error) {
      console.error("Error sending API response:", error);
      if (!res.headersSent) {
        res.status(500).json({
          status: "error",
          error: "Failed to send response"
        });
      }
    } finally {
      this.cleanupResponse(responseId);
    }
  }

  private handleResponseTimeout(responseId: string) {
    const res = this.pendingResponses.get(responseId);
    if (res) {
      res.status(504).json({
        status: "error",
        error: "Request timed out"
      });
      this.cleanupResponse(responseId);
    }
  }

  private cleanupResponse(responseId: string) {
    this.pendingResponses.delete(responseId);
    const timeout = this.responseTimeouts.get(responseId);
    if (timeout) {
      clearTimeout(timeout);
      this.responseTimeouts.delete(responseId);
    }
  }
}
