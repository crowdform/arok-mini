// src/services/message.service.ts

import { EventEmitter } from "events";
import { Message } from "../types/message.types";
import debug from "debug";

const log = debug("arok:message-service");

export class MessageService {
  private eventEmitter: EventEmitter;
  private readonly INCOMING = "message:incoming";
  private readonly OUTGOING = "message:outgoing";

  constructor() {
    this.eventEmitter = new EventEmitter();
  }

  // Publish incoming message
  async publish(message: Message): Promise<void> {
    log("Publishing incoming message:", message);
    this.eventEmitter.emit(this.INCOMING, message);
  }

  // Send outgoing message
  async send(message: Message): Promise<void> {
    log("Sending outgoing message:", message);
    this.eventEmitter.emit(this.OUTGOING, message);
  }

  // Subscribe to incoming messages
  subscribe(handler: (message: Message) => Promise<void>): void {
    this.eventEmitter.on(this.INCOMING, handler);
  }

  // Subscribe to outgoing messages
  subscribeToOutgoing(handler: (message: Message) => Promise<void>): void {
    this.eventEmitter.on(this.OUTGOING, handler);
  }

  // Remove a specific subscription
  unsubscribe(event: "incoming" | "outgoing", handler: Function): void {
    const eventName = event === "incoming" ? this.INCOMING : this.OUTGOING;
    // @ts-ignore
    this.eventEmitter.removeListener(eventName, handler);
  }

  // Clear all subscriptions
  clearSubscriptions(): void {
    this.eventEmitter.removeAllListeners(this.INCOMING);
    this.eventEmitter.removeAllListeners(this.OUTGOING);
  }
}
