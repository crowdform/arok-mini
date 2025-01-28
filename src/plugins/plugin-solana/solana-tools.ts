import { tool, type CoreTool } from "ai";
import { ACTIONS } from "solana-agent-kit";

import { LOOKUP_SEARCH_TOKEN } from "./actions/token-lookup";

const whitelist = [
  "GET_INFO_ACTION",
  "WALLET_ADDRESS_ACTION",
  "TOKEN_BALANCES_ACTION",
  "DEPLOY_TOKEN_ACTION",
  "BALANCE_ACTION",
  "TRANSFER_ACTION",
  "TRADE_ACTION",
  // "GET_TOKEN_DATA_ACTION",
  "FETCH_PRICE_ACTION",
  "PYTH_FETCH_PRICE_ACTION",
  "GET_ASSETS_BY_OWNER_ACTION",
  "PARSE_TRANSACTION_ACTION",
  "SEND_TRANSACTION_WITH_PRIORITY_ACTION"
];

const customActions = {
  LOOKUP_SEARCH_TOKEN
};

const ALL_ACTIONS = { ...ACTIONS, ...customActions };

export const getSolanaToolsSchema = () => {
  const tools: Record<string, CoreTool> = {};

  const actionKeys = Object.keys(ALL_ACTIONS);

  for (const key of actionKeys) {
    if (!whitelist.includes(key)) {
      continue;
    }
    const action = ALL_ACTIONS[key as keyof typeof ACTIONS];
    tools[key] = tool({
      //  @ts-ignore
      id: action.name,
      description: `
      ${action.description}

      solana-tools: ${key}
      Similes: ${action.similes.map(
        (simile: string) => `
        ${simile}
      `
      )}
      `.slice(0, 1023),
      parameters: action.schema
    });
  }

  return tools;
};

export const getAction = (key: string) =>
  ALL_ACTIONS[key as keyof typeof ACTIONS];
