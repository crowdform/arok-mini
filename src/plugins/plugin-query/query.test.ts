// src/plugins/plugin-query/index.test.ts

import { describe, test, expect, beforeEach } from "bun:test";
import { QueryPlugin } from "./index";
import debug from "debug";

// Enable debug logging
debug.enable("arok:plugin:query*");
const log = debug("arok:plugin:query:test");

describe("QueryPlugin", () => {
  let plugin: QueryPlugin;
  let queryAction: any;

  beforeEach(() => {
    plugin = new QueryPlugin();
    queryAction = plugin.actions.QUERY;
  });

  describe("QUERY action", () => {
    test("should be properly initialized", () => {
      expect(queryAction).toBeDefined();
      expect(typeof queryAction.execute).toBe("function");
    });

    test("should fetch Base chain activity", async () => {
      const result = await queryAction.execute({
        topic: "What's the latest activity on Base chain?"
      });

      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(typeof result.data).toBe("string");
      expect(result.data.length).toBeGreaterThan(0);
    }, 30000); // 30 second timeout for API call

    test("should fetch low cap token info", async () => {
      const result = await queryAction.execute({
        topic: "What is a low cap token on base?"
      });

      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(typeof result.data).toBe("string");
      expect(result.data.length).toBeGreaterThan(0);
    }, 30000);

    test("should handle meme token trends query", async () => {
      const result = await queryAction.execute({
        topic: "What are the current meme token trends?"
      });

      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(typeof result.data).toBe("string");
      expect(result.data.length).toBeGreaterThan(0);
    }, 30000);

    test("should handle query with additional context", async () => {
      const result = await queryAction.execute({
        topic: "Base chain activity",
        context: "focusing on DEX volume"
      });

      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(typeof result.data).toBe("string");
      expect(result.data.length).toBeGreaterThan(0);
    }, 30000);

    test("should handle error cases gracefully", async () => {
      // @ts-ignore - intentionally passing invalid data
      await expect(
        queryAction.execute({
          topic: ""
        })
      ).rejects.toThrow();
    });
  });

  describe("Plugin metadata", () => {
    test("should have correct metadata structure", () => {
      expect(plugin.metadata).toBeDefined();
      expect(plugin.metadata.name).toBe("QUERY_KNOWLEDGE");
      expect(plugin.metadata.version).toBe("1.0.0");
      expect(plugin.metadata.actions.QUERY).toBeDefined();
    });

    test("should have properly defined QUERY action schema", () => {
      const queryActionMeta = plugin.metadata.actions.QUERY;
      expect(queryActionMeta.schema).toBeDefined();
      expect(queryActionMeta.schema.properties.topic).toBeDefined();
      expect(queryActionMeta.schema.properties.topic.required).toBe(true);
    });
  });
});
