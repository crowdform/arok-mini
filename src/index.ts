// src/index.ts

import { config } from "dotenv";
import express from "express";
// Load environment variables
config();
import { CharacterLoader } from "./services/character.loader";
import { AgentService } from "./services/agent.service";
import { getLLMInstance, getProviderConfig } from "./services/llm.providers";

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
    const character = await characterLoader.loadCharacter(
      (process.env.CHARACTER_FILE_NAME as string) || "default"
    );
    log(`Loaded character: ${character.name}`);

    // Get LLM provider configuration from environment variables
    const { provider, config: providerConfig } = getProviderConfig();
    const llmInstance = getLLMInstance(provider, providerConfig);
    log(`LLM provider initialized: ${provider}`);

    const agent = new AgentService({
      characterConfig: character,
      // @ts-ignore
      llmInstance: llmInstance,
      llmInstanceModel: providerConfig.model,
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
