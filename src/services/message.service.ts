// src/services/message.service.ts

import { EventEmitter } from "events";
import {
  Message,
  ResponseHandler,
  ROUTING_PATTERNS
} from "../types/message.types";
import debug from "debug";

const log = debug("arok:message-service");

export class MessageService {
  private eventEmitter: EventEmitter;
  private responseHandlers: Map<string, ResponseHandler>;
  private subscribers: Map<string, Set<(message: Message) => Promise<void>>>;
  private readonly DEFAULT_TIMEOUT = 30000;

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.responseHandlers = new Map();
    this.subscribers = new Map();
  }

  subscribe(
    routingKey: string,
    handler: (message: Message) => Promise<void>
  ): () => void {
    if (!this.subscribers.has(routingKey)) {
      this.subscribers.set(routingKey, new Set());
    }
    this.subscribers.get(routingKey)!.add(handler);

    return () => {
      const handlers = this.subscribers.get(routingKey);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.subscribers.delete(routingKey);
        }
      }
    };
  }

  private determineResponseRoutingKey(originalMessage: Message): string {
    const currentKey = originalMessage.metadata?.routingKey;
    if (!currentKey) return "default";

    // Handle standard patterns
    if (currentKey === ROUTING_PATTERNS.API.REQUEST) {
      return ROUTING_PATTERNS.AGENT.PROCESS;
    }
    if (currentKey === ROUTING_PATTERNS.AGENT.PROCESS) {
      return ROUTING_PATTERNS.API.RESPONSE;
    }

    // Handle plugin patterns
    if (currentKey.startsWith("plugin.")) {
      const parts = currentKey.split(".");
      if (parts.length === 3 && parts[2] === "request") {
        return `plugin.${parts[1]}.response`;
      }
    }

    // Default to response version of current key
    return `${currentKey}.response`;
  }

  createResponse(
    originalMessage: Message,
    content: string,
    overrideRoutingKey?: string,
    errorMessage?: Message
  ): Message {
    const nextRoutingKey =
      overrideRoutingKey || this.determineResponseRoutingKey(originalMessage);

    return {
      id: crypto.randomUUID(), // New unique ID for this response
      content,
      author: "agent",
      participants: [originalMessage.author],
      type: "response",
      requestId: originalMessage.id, // Link to the message being responded to
      source: originalMessage.source,
      createdAt: new Date().toISOString(),
      ...errorMessage,
      metadata: {
        ...errorMessage?.metadata,
        routingKey: nextRoutingKey,
        timestamp: Date.now(),
        handled: false
      }
    };
  }

  async publish(message: Message): Promise<Message | null> {
    // Ensure chainId is set for new request chains
    if (message.type === "request" && !message.chainId) {
      message.chainId = message.id;
    }

    const timestamp = Date.now();
    message.metadata = { ...message.metadata, timestamp };

    if (message.type === "response" && message.requestId) {
      return this._handleResponse(message);
    }

    if (message.metadata?.responseNeeded) {
      return this._publishWithResponse(message);
    }

    await this._routeMessage(message);
    return null;
  }

  private async _publishWithResponse(message: Message): Promise<Message> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseHandlers.delete(message.id);
        reject(new Error(`Response timeout for message ${message.id}`));
      }, message.metadata?.timeout || this.DEFAULT_TIMEOUT);

      this.responseHandlers.set(message.id, {
        // @ts-ignore
        resolve,
        reject,
        timeout
      });

      this._routeMessage(message).catch(reject);
    });
  }

  private async _handleResponse(response: Message): Promise<null> {
    const handler = this.responseHandlers.get(response.requestId!);
    if (handler) {
      clearTimeout(handler.timeout);
      this.responseHandlers.delete(response.requestId!);
      handler.resolve(response);
    }

    await this._routeMessage(response);
    return null;
  }

  private async _routeMessage(message: Message): Promise<void> {
    if (message.metadata?.handled) {
      return;
    }

    const routingKey = message.metadata?.routingKey || "default";
    const handlers = this.subscribers.get(routingKey);

    if (handlers) {
      message.metadata = { ...message.metadata, handled: true };

      const promises = Array.from(handlers).map(async (handler) => {
        try {
          await handler(message);
        } catch (error) {
          console.error(`Error in message handler for ${routingKey}:`, error);
        }
      });

      await Promise.all(promises);
    }
  }

  clear(): void {
    this.subscribers.clear();
    for (const handler of this.responseHandlers.values()) {
      clearTimeout(handler.timeout);
    }
    this.responseHandlers.clear();
  }
}
