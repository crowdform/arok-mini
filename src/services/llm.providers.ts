// src/services/llm/provider.ts

import { createOpenAI } from "@ai-sdk/openai";
import { createFireworks } from "@ai-sdk/fireworks";
import { createGroq } from "@ai-sdk/groq";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import debug from "debug";

const log = debug("arok:llm-provider");

export type LLMProvider =
  | "openai"
  | "together"
  | "fireworks"
  | "groq"
  | "deepinfra";

export interface ProviderConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  headers?: Record<string, string>;
}

export function getLLMInstance(provider: LLMProvider, config: ProviderConfig) {
  log(`Initializing LLM provider: ${provider}`);

  switch (provider) {
    case "openai":
      return createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        headers: config.headers
      });

    case "together":
      return createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        headers: config.headers
      });

    case "fireworks":
      return createFireworks({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        headers: config.headers
      });

    case "groq":
      return createGroq({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        headers: config.headers
      });

    case "deepinfra":
      return createDeepInfra({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        headers: config.headers
      });

    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

export function getProviderConfig(): {
  provider: LLMProvider;
  config: ProviderConfig;
} {
  // Get the active provider from environment variables
  const activeProvider = (
    process.env.LLM_PROVIDER || "openai"
  ).toLowerCase() as LLMProvider;
  let heliconeHeaders = {};

  // Configure Helicone headers if API key exists
  if (process.env.HELICONE_API_KEY) {
    heliconeHeaders = {
      "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY}`,
      "Helicone-Property-Name": `${process.env.PLUGIN_TWITTER_USERNAME || "default"}/default`
    };
  }

  // Configuration for each provider
  const providers: Record<LLMProvider, ProviderConfig> = {
    openai: {
      apiKey: process.env.OPENAI_API_KEY || "",
      baseURL: process.env.OPENAI_BASE_URL || "https://oai.helicone.ai/v1",
      model: process.env.OPENAI_MODEL || "gpt-4-turbo",
      headers: heliconeHeaders
    },

    together: {
      apiKey: process.env.TOGETHER_API_KEY || "",
      baseURL:
        process.env.TOGETHER_BASE_URL ||
        `https://together.helicone.ai/v1/${process.env.HELICONE_API_KEY}`,
      model:
        process.env.TOGETHER_MODEL ||
        "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo",
      headers: heliconeHeaders
    },

    fireworks: {
      apiKey: process.env.FIREWORKS_API_KEY || "",
      baseURL: process.env.FIREWORKS_BASE_URL,
      model: process.env.FIREWORKS_MODEL || "",
      headers: {
        Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}`,
        ...heliconeHeaders
      }
    },

    groq: {
      apiKey: process.env.GROQ_API_KEY || "",
      baseURL: process.env.GROQ_BASE_URL,
      model: process.env.GROQ_MODEL || "",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        ...heliconeHeaders
      }
    },

    deepinfra: {
      apiKey: process.env.DEEPINFRA_API_KEY || "",
      baseURL: process.env.DEEPINFRA_BASE_URL,
      model: process.env.DEEPINFRA_MODEL || "",
      headers: {
        Authorization: `Bearer ${process.env.DEEPINFRA_API_KEY}`,
        ...heliconeHeaders
      }
    }
  };

  // Validate the selected provider configuration
  const config = providers[activeProvider];
  if (!config.apiKey) {
    throw new Error(`API key for provider ${activeProvider} is not configured`);
  }

  if (!config.model) {
    throw new Error(`Model for provider ${activeProvider} is not configured`);
  }

  log(`Using LLM provider: ${activeProvider}, model: ${config.model}`);
  return { provider: activeProvider, config };
}
