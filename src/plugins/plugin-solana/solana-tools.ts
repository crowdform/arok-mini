import { tool, type CoreTool } from "ai";
import { ACTIONS, SolanaAgentKit, executeAction } from "solana-agent-kit";

export const getSolanaToolsSchema = () => {
  const tools: Record<string, CoreTool> = {};
  const actionKeys = Object.keys(ACTIONS);

  for (const key of actionKeys) {
    const action = ACTIONS[key as keyof typeof ACTIONS];
    tools[key] = tool({
      //  @ts-ignore
      id: action.name,
      description: `
      ${action.description}

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

export const getAction = (key: string) => ACTIONS[key as keyof typeof ACTIONS];
