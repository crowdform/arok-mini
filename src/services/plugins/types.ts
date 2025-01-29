// src/plugins/types.ts

import { Message } from "../../types/message.types";
import { MessageService } from "../message.service";
import { MemoryService } from "../memory.service";
import { CacheService } from "../cache.service";
import { LLMService } from "../llm.service";
import { StateService } from "../state.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { AgentService } from "../agent.service";
import { z } from "zod";

export interface PluginContext {
  messageBus: MessageService;
  memoryService: MemoryService;
  cacheService: CacheService;
  llmService: LLMService;
  stateService: StateService;
  schedulerService: SchedulerService;
  agentService: AgentService;
}

export type SchemaPropertyType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "null"
  | "any";

export interface SchemaProperty {
  type: SchemaPropertyType;
  description?: string;
  required?: boolean;
  enum?: Array<string | number>;
  pattern?: string;
  items?: SchemaProperty | SchemaProperty[];
  properties?: Record<string, SchemaProperty>;
  additionalProperties?: boolean | SchemaProperty;
  default?: any;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  examples?: any[];
  nullable?: boolean;
}

export interface ActionSchema {
  type: SchemaPropertyType;
  required?: string[];
  properties: Record<string, SchemaProperty>;
  additionalProperties?: boolean;
  description?: string;
  title?: string;
  examples?: any[];
  definitions?: Record<string, SchemaProperty>;
  $ref?: string;
}

export interface ActionMetadata {
  description: string;
  schema: ActionSchema;
  scope?: string[];
  examples: {
    input: string | Record<string, any>;
    output: string | Record<string, any>;
  }[];
}

export interface PluginMetadata {
  name: string;
  description: string;
  version: string;
  callable: boolean;
  actions: Record<string, ActionMetadata>;
  getSystemPrompt?(): string | null;
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
}

// Base Plugin interface without method visibility constraints
export interface Plugin extends BasePluginInterface {
  actions: Record<string, (message: Message, data: any) => Promise<void>>;
}

// Extended Plugin interface that includes PluginAction interface
export interface ExtendedPlugin extends BasePluginInterface {
  actions: Record<string, PluginAction>;
}

// Simple actions
export interface ActionExample {
  input: Record<string, any>;
  output: Record<string, any>;
  explanation: string;
}

export interface Action<K = any> {
  /**
   * Unique name of the action
   */
  name: string;
  /**
   * Alternative names/phrases that can trigger this action
   */
  similes: string[];
  /**
   * Detailed description of what the action does
   */
  description: string;
  /**
   * Array of example inputs and outputs for the action
   * Each inner array represents a group of related examples
   */
  examples: ActionExample[][];
  /**
   * Zod schema for input validation
   */
  schema: z.ZodType<any>;
  /**
   * Function that executes the action
   */
  handler: Handler<K>;
}

export type Handler<K> = (
  context: K,
  input: Record<string, any>
) => Promise<Record<string, any>>;
