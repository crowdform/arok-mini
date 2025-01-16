// src/plugins/types.ts

import { Message } from "../../types/message.types";
import { MessageService } from "../message.service";
import { MemoryService } from "../memory.service";
import { CacheService } from "../cache.service";
import { LLMService } from "../llm.service";
import { StateService } from "../state.service";
import { SchedulerService } from "../scheduler/scheduler.service";

export interface PluginContext {
  messageBus: MessageService;
  memoryService: MemoryService;
  cacheService: CacheService;
  llmService: LLMService;
  stateService: StateService;
  schedulerService: SchedulerService;
}

export interface ActionSchema {
  type: string;
  required: string[];
  properties: Record<
    string,
    {
      type: string;
      description: string;
      required?: boolean;
      items?: {
        type: string;
      };
      enum?: string[];
      pattern?: string;
    }
  >;
}

export interface ActionMetadata {
  description: string;
  schema: ActionSchema;
  scope?: string[];
  examples: {
    input: string;
    output: string;
  }[];
}

export interface PluginMetadata {
  name: string;
  description: string;
  version: string;
  callable: boolean;
  actions: Record<string, ActionMetadata>;
}

export interface ActionExecutionContext {
  chainId?: string;
  actionOrder?: number;
  parentMessage: Message;
  dependencyResults?: Record<string, any>;
}

export interface PluginAction<TInput = any, TOutput = any> {
  execute(data: TInput, context?: ActionExecutionContext): Promise<TOutput>;
}

export interface BasePluginInterface {
  metadata: PluginMetadata;
  initialize(context: PluginContext): Promise<void>;
  start?(): Promise<void> | void;
  shutdown?(): Promise<void> | void;
  handleMessage?(message: Message): Promise<void>;
}

// Base Plugin interface without method visibility constraints
export interface Plugin extends BasePluginInterface {
  actions: Record<string, (message: Message, data: any) => Promise<void>>;
}

// Extended Plugin interface that includes PluginAction interface
export interface ExtendedPlugin extends BasePluginInterface {
  actions: Record<string, PluginAction>;
}
