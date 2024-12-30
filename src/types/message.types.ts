export interface Message {
  id: string;
  content: string;
  author: string;
  participants?: string[];
  createdAt: string;
  parentId?: string;
  source: "twitter" | "api" | "system" | "plugin" | "agent" | "automated";
  metadata?: Record<string, any>;
}

export interface MessageBus {
  publish(message: Message): Promise<void>;
  subscribe(handler: (message: Message) => Promise<void>): void;
}
