import { Action, SolanaAgentKit } from "solana-agent-kit";
import { z } from "zod";

const API_URL = "https://api.dexscreener.com";

interface TokenPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  marketCap: number;
  priceNative: string;
  priceUsd: string;
  txns: {
    h24: {
      buys: number;
      sells: number;
    };
  };
  volume: {
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  pairCreatedAt: number;
  url: string;
}

interface DexScreenerResponse {
  schemaVersion: string;
  pairs: TokenPair[];
}

/**
 * Cleans a string by removing dollar signs, spaces, and converting to lowercase
 */
function cleanString(input: string): string {
  if (typeof input !== "string") {
    throw new Error("Input must be a string");
  }
  return input.replace(/\$/g, "").replace(/\s+/g, "").toLowerCase();
}

/**
 * Calculates a score for token pairs based on various metrics
 */
function calculatePairScore(pair: TokenPair): number {
  let score = 0;

  // Age score (older is better) - 20 points max
  const ageInDays = (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60 * 24);
  score += (Math.min(ageInDays, 365) / 365) * 20;

  // Liquidity score - 25 points max
  const liquidityScore =
    (Math.min(pair.liquidity?.usd || 0, 1000000) / 1000000) * 25;
  score += liquidityScore;

  // Volume score (24h) - 25 points max
  const volumeScore = (Math.min(pair.volume?.h24 || 0, 1000000) / 1000000) * 25;
  score += volumeScore;

  // Transaction score (24h) - 30 points max
  const txCount = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
  const txScore = (Math.min(txCount, 1000) / 1000) * 30;
  score += txScore;

  return score;
}

/**
 * Searches for token pairs using DexScreener API
 */
async function searchCashTags(cashtag: string): Promise<{
  success: boolean;
  data?: TokenPair | null;
  error?: string;
}> {
  const _cashtag = cleanString(cashtag);
  const apiUrl = `${API_URL}/latest/dex/search?q=${_cashtag}`;

  try {
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = (await response.json()) as DexScreenerResponse;

    if (!data.pairs || data.pairs.length === 0) {
      return {
        success: false,
        error: `No matching pairs found for ${_cashtag}`
      };
    }

    // Score and sort pairs
    const scoredPairs = data.pairs.map((pair) => ({
      ...pair,
      score: calculatePairScore(pair)
    }));

    const sortedPairs = scoredPairs.sort((a, b) => b.score - a.score);
    return { success: true, data: sortedPairs[0] };
  } catch (error) {
    console.error("Error in searchCashTags:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred"
    };
  }
}

export const LOOKUP_SEARCH_TOKEN: Action = {
  name: "LOOKUP_SEARCH_TOKEN",
  similes: [
    "find token",
    "search token",
    "get token address",
    "lookup token",
    "what is token address",
    "token contract",
    "find cashtag",
    "whats the contract address of token"
  ],
  description:
    "Search for token contract address and information using cashtag or token name",
  examples: [
    [
      {
        input: {
          query: "$SOL"
        },
        output: {
          status: "success",
          data: {
            baseToken: {
              address: "So11111111111111111111111111111111111111112",
              name: "Solana",
              symbol: "SOL"
            },
            marketCap: 1234567890,
            priceUsd: "123.45"
          }
        },
        explanation: "Look up Solana token information using $SOL cashtag"
      }
    ],
    [
      {
        input: {
          query: "Bitcoin"
        },
        output: {
          status: "success",
          data: {
            baseToken: {
              address: "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E",
              name: "Bitcoin",
              symbol: "BTC"
            },
            marketCap: 9876543210,
            priceUsd: "45678.90"
          }
        },
        explanation: "Look up Bitcoin token information using token name"
      }
    ]
  ],
  schema: z.object({
    query: z
      .string()
      .min(1)
      .max(100)
      .describe(
        "The token cashtag or name to search for (e.g. '$SOL' or 'Solana')"
      )
  }),
  handler: async (agent: SolanaAgentKit, input: Record<string, any>) => {
    try {
      const { query } = input;
      const result = await searchCashTags(query);

      if (!result.success || !result.data) {
        return {
          status: "error",
          message: result.error || "Token not found"
        };
      }

      const { baseToken, marketCap, priceUsd, dexId, pairAddress, url } =
        result.data;

      return {
        status: "success",
        data: {
          baseToken,
          marketCap,
          priceUsd,
          dexId,
          pairAddress,
          url,
          age: Math.floor(
            (Date.now() - result.data.pairCreatedAt) / (1000 * 60 * 60 * 24)
          ),
          liquidity: result.data.liquidity.usd,
          volume24h: result.data.volume.h24,
          transactions24h: {
            buys: result.data.txns.h24.buys,
            sells: result.data.txns.h24.sells
          }
        }
      };
    } catch (error: any) {
      if (error.response) {
        const { status, data } = error.response;
        if (status === 429) {
          return {
            status: "error",
            message: "Rate limit exceeded. Please try again later."
          };
        }
        return {
          status: "error",
          message: `API error: ${data.error?.message || error.message}`
        };
      }

      return {
        status: "error",
        message: `Failed to lookup token: ${error.message}`
      };
    }
  }
};
