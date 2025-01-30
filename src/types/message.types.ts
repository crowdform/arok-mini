export interface Message {
  id: string;
  content: string;
  author: string;
  participants: string[];
  type: "request" | "response" | "event";
  requestId?: string; // Original request ID if this is a response
  source:
    | "twitter"
    | "api"
    | "system"
    | "plugin"
    | "agent"
    | "automated"
    | "telegram";
  createdAt: string;
  chainId?: string;
  metadata?: {
    handled?: boolean;
    responseNeeded?: boolean;
    routingKey?: string;
    timeout?: number;
    timestamp?: number;
    error?: any;
    isError?: boolean;
    [key: string]: any;
  };
}

export interface MessageBus {
  publish(message: Message): Promise<void>;
  subscribe(handler: (message: Message) => Promise<void>): void;
}

export type Timer = ReturnType<typeof setTimeout>;

export interface ResponseHandler {
  resolve: (value: Message | null) => void;
  reject: (error: Error) => void;
  timeout: Timer;
}

export const ROUTING_PATTERNS = {
  API: {
    REQUEST: "api.request",
    RESPONSE: "api.response"
  },
  AGENT: {
    PROCESS: "agent.process",
    RESPONSE: "agent.response"
  },
  PLUGIN: {
    REQUEST: (pluginName: string) => `plugin.${pluginName}.request`,
    RESPONSE: (pluginName: string) => `plugin.${pluginName}.response`
  }
} as const;
