import { v5 as uuidv5 } from "uuid";

const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // This is the URL namespace UUID
const CUSTOM_NAMESPACE = uuidv5("AROK-MINI", NAMESPACE);

export type UUID = `${string}-${string}-${string}-${string}-${string}`;

export function stringToUuid(inputString: string): UUID {
  return uuidv5(inputString, CUSTOM_NAMESPACE) as UUID;
}

// src/utils/ai-parser.ts

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export class AIResponseParser {
  /**
   * Extract and parse JSON from AI response text
   */
  static parseJSON<T = JsonValue>(response: string | any): T {
    try {
      // If already parsed, return as is
      if (typeof response !== "string") {
        return response as T;
      }

      // Clean the response text
      const cleaned = this.cleanResponse(response);

      // Try parsing the cleaned response
      try {
        return JSON.parse(cleaned) as T;
      } catch (e) {
        // If initial parse fails, try to extract JSON from the text
        const extracted = this.extractJSON(cleaned);
        if (extracted) {
          return JSON.parse(extracted) as T;
        }
        throw e;
      }
    } catch (error) {
      console.error("Error parsing AI response:", error);
      // @ts-ignore
      throw new Error(`Failed to parse AI response: ${error?.message}`);
    }
  }

  /**
   * Clean response text by removing markdown and normalizing
   */
  static cleanResponse(response: string): string {
    return response
      .replace(/```(?:json)?\s*\n?/g, "") // Remove markdown code blocks
      .replace(/```\s*\n?/g, "") // Remove closing code blocks
      .replace(/\n/g, "") // Remove newlines
      .replace(/\r/g, "") // Remove carriage returns
      .replace(/\t/g, "") // Remove tabs
      .replace(/\s+/g, " ") // Normalize whitespace
      .replace(/\\"/g, '"') // Fix escaped quotes
      .replace(/\\n/g, " ") // Replace escaped newlines with space
      .trim(); // Trim whitespace
  }

  /**
   * Try to extract JSON from a text that might contain other content
   */
  static extractJSON(text: string): string | null {
    // Try to find JSON array or object
    const matches = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    return matches ? matches[1] : null;
  }

  /**
   * Parse array of strings from AI response
   */
  static parseStringArray(response: string | any): string[] {
    try {
      const parsed = this.parseJSON<string[]>(response);
      if (!Array.isArray(parsed)) {
        // If not array, split by common delimiters
        return String(parsed)
          .split(/[,\n]+/)
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return parsed
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch (error) {
      // Fall back to splitting the raw response
      return String(response)
        .split(/[,\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  /**
   * Validate parsed JSON against expected schema
   */
  static validateSchema<T>(
    parsed: any,
    validator: (value: any) => boolean,
    errorMessage: string = "Invalid data structure"
  ): T {
    if (!validator(parsed)) {
      throw new Error(errorMessage);
    }
    return parsed as T;
  }
}

// Usage examples:

/*
// Example 1: Parse JSON object from markdown
const response1 = `Here's the data:
\`\`\`json
{
  "name": "John",
  "age": 30
}
\`\`\``;

const data = AIResponseParser.parseJSON(response1);
// { name: "John", age: 30 }

// Example 2: Parse array of strings
const response2 = `Generated topics:
\`\`\`json
[
  "AI and Ethics",
  "Machine Learning",
  "Neural Networks"
]
\`\`\``;

const topics = AIResponseParser.parseStringArray(response2);
// ["AI and Ethics", "Machine Learning", "Neural Networks"]

// Example 3: Parse with validation
interface User {
  name: string;
  age: number;
}

const isUser = (value: any): value is User => 
  typeof value === 'object' &&
  typeof value.name === 'string' &&
  typeof value.age === 'number';

const user = AIResponseParser.parseJSON<User>(response1);
const validUser = AIResponseParser.validateSchema<User>(
  user,
  isUser,
  'Invalid user data'
);
*/
