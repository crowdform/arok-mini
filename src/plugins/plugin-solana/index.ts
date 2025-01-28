import "rpc-websockets/dist/lib/client";

import {
  ExtendedPlugin,
  PluginAction,
  PluginContext,
  PluginMetadata
} from "../../services/plugins/types";

import { Message } from "../../types/message.types";
import debug from "debug";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { SolanaAgentKit, executeAction } from "solana-agent-kit";
import { tool, type CoreTool } from "ai";

import { getSolanaToolsSchema, getAction } from "./solana-tools";

const log = debug("arok:plugin:solana");

interface UserWallet {
  publicKey: string;
  privateKey: string;
  createdAt: number;
  lastUsed: number;
}

export class SolanaPlugin implements ExtendedPlugin {
  private context!: PluginContext;
  private readonly WALLET_CACHE_PREFIX = "wallet:";
  private readonly WALLET_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private tools: Record<string, CoreTool> = {};
  actions = {};
  metadata: PluginMetadata = {
    name: "solana",
    description: "Solana blockchain integration using Solana Agent Kit",
    version: "1.0.0",
    callable: true,
    actions: {} // Actions will be populated from Solana Agent Kit tools
  };

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;

    // Get tools from Solana Agent Kit
    const solanaTools = getSolanaToolsSchema();

    // Wrap each tool with user wallet injection
    for (const [key, solanaTool] of Object.entries(solanaTools)) {
      // Add tool metadata to plugin actions
      this.metadata.actions[key] = {
        // @ts-ignore
        description: solanaTool.description || key,
        schema: solanaTool.parameters || { type: "object", properties: {} },
        examples: [],
        scope: ["*"]
      };

      // Create wrapped tool with user wallet injection
      // @ts-ignore
      this.actions[key] = {
        execute: async (params: any) => {
          try {
            // Extract userId from params
            const { userId } = params;
            // if (!userId) {
            //   throw new Error("userId is required for Solana operations");
            // }

            // Get user wallet
            const wallet = await this.getOrCreateUserWallet(
              userId || "default"
            );

            log(`Executing Solana tool ${key} with wallet:`, wallet);

            const solanaKit = new SolanaAgentKit(
              wallet.privateKey,
              process.env.PLUGIN_SOLANA_RPC_URL as string,
              {}
            );

            // Execute original tool with enriched params
            return await executeAction(getAction(key), solanaKit, params);
          } catch (error) {
            console.error(
              `Error executing Solana tool ${getAction(key)}:`,
              error
            );
            throw error;
          }
        }
      };
    }

    log("Solana plugin initialized with tools:", Object.keys(this.tools));
  }

  private async getOrCreateUserWallet(userId: string): Promise<UserWallet> {
    try {
      const cacheKey = `${this.WALLET_CACHE_PREFIX}${userId}`;

      // Check cache first
      const cachedWallet = await this.context.cacheService.get(cacheKey);
      if (cachedWallet) {
        // Update last used timestamp
        const updatedWallet = {
          ...cachedWallet,
          lastUsed: Date.now()
        };
        await this.context.cacheService.update(cacheKey, updatedWallet, {
          type: "wallet",
          userId,
          updated: Date.now()
        });
        return updatedWallet;
      }

      // Create new wallet
      const keypair = Keypair.generate();
      const wallet: UserWallet = {
        publicKey: keypair.publicKey.toString(),
        privateKey: bs58.encode(keypair.secretKey),
        createdAt: Date.now(),
        lastUsed: Date.now()
      };

      // Save to cache
      await this.context.cacheService.set(cacheKey, wallet, {
        type: "wallet",
        userId,
        created: wallet.createdAt,
        ttl: this.WALLET_CACHE_TTL
      });

      return wallet;
    } catch (error) {
      console.error("Error getting/creating wallet:", error);
      throw error;
    }
  }

  // Optional cleanup method
  async shutdown(): Promise<void> {
    log("Solana plugin shutting down");
  }
}

// Export plugin
export default SolanaPlugin;
