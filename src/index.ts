// src/index.ts

import { config } from "dotenv";
import express from "express";
// Load environment variables
config();
import { CharacterLoader } from "./services/character.loader";
import { AgentService } from "./services/agent.service";
import { createOpenAI } from "@ai-sdk/openai";
import { createFireworks } from "@ai-sdk/fireworks";
import { createGroq } from "@ai-sdk/groq";
import { createDeepInfra } from "@ai-sdk/deepinfra";

import debug from "debug";

const log = debug("arok:init");

// plugins

import { PluginLoader } from "./services/plugins/plugin.loader";

async function startServer() {
  try {
    // Initialize Express app
    const app = express();
    const PORT = process.env.PORT || 8080;

    app.use(express.json());

    // Load character configuration
    const characterLoader = new CharacterLoader();
    const character = await characterLoader.loadCharacter("default");
    log(`Loaded character: ${character.name}`);

    const openaiConfig = {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: "https://oai.helicone.ai/v1",
      headers: {
        "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY}`,
        "Helicone-Property-Name": `${process.env.PLUGIN_TWITTER_USERNAME}/default`
      },
      model: "gpt-4-turbo"
    };

    const togetherAiConfig = {
      apiKey: process.env.TOGETHER_API_KEY,
      baseURL: `https://together.helicone.ai/v1/${process.env.HELICONE_API_KEY}`,
      headers: {
        "Helicone-Property-Name": `${process.env.PLUGIN_TWITTER_USERNAME}/default`
      },
      // model: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo"
      // model: "deepseek-ai/deepseek-llm-67b-chat"
      model: "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo"
    };
    const llmInstance = createOpenAI({
      ...openaiConfig
    });

    const fireworksModel = process.env.FIREWORKS_MODEL as string;
    const fireworksInstance = createFireworks({
      apiKey: process.env.FIREWORKS_API_KEY,
      baseURL: process.env.FIREWORKS_BASE_URL,
      headers: {
        Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}`,
        "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY}`,
        "Helicone-Property-Name": `${process.env.PLUGIN_TWITTER_USERNAME}/default`
      }
    });

    const groqModel = process.env.GROQ_MODEL as string;
    const groqInstance = createGroq({
      apiKey: process.env.GROQ_API_KEY,
      // baseURL: process.env.GROQ_BASE_URL,
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY}`,
        "Helicone-Property-Name": `${process.env.PLUGIN_TWITTER_USERNAME}/default`
      }
    });

    const deepinfraModel = process.env.DEEPINFRA_MODEL as string;
    const deepinfraInstance = createDeepInfra({
      apiKey: process.env.DEEPINFRA_API_KEY,
      baseURL: process.env.DEEPINFRA_BASE_URL,
      headers: {
        Authorization: `Bearer ${process.env.DEEPINFRA_API_KEY}`,
        "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY}`,
        "Helicone-Property-Name": `${process.env.PLUGIN_TWITTER_USERNAME}/default`
      }
    });
    const agent = new AgentService({
      characterConfig: character,
      // @ts-ignore
      llmInstance: deepinfraInstance,
      llmInstanceModel: deepinfraModel,
      schedulerConfig: {
        mode: "single-node",
        timeZone: "UTC",
        heartbeatInterval: 60000
      }
    });

    const loader = new PluginLoader(agent, app);
    await loader.loadPlugins(character.plugins);

    console.log("Clients started successfully");
    // Basic health check endpoint
    app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    });

    // Start the server
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
      console.log("Environment:", process.env.NODE_ENV || "development");
    });

    await agent.start();
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown handling
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Starting graceful shutdown...");
  // Add cleanup logic here if needed
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Starting graceful shutdown...");
  // Add cleanup logic here if needed
  process.exit(0);
});

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Start the server
startServer().catch((error) => {
  console.error("Failed to start application:", error);
  process.exit(1);
});
