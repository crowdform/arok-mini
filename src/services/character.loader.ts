// src/services/character.loader.ts

import fs from "fs/promises";
import path from "path";
import debug from "debug";

const log = debug("arok:character-loader");

export interface CharacterStyle {
  all: string[];
  chat: string[];
  post: string[];
}

export interface CharacterSettings {
  model: string;
  secrets: Record<string, string>;
  voice?: {
    model: string;
  };
  embeddingModel?: string;
}

export interface Character {
  name: string;
  clients: string[];
  plugins: string[];
  modelProvider: string;
  settings: CharacterSettings;
  system: string;
  bio: string[];
  lore: string[];
  knowledge: string[];
  messageExamples: Array<{ user: string; content: { text: string } }>;
  postExamples: string[];
  adjectives: string[];
  topics: string[];
  people?: string[];
  style: CharacterStyle;
}

export class CharacterLoader {
  private characterCache: Map<string, Character> = new Map();
  private readonly baseDir: string;

  constructor(baseDir: string = "../characters") {
    this.baseDir = baseDir;
  }

  async loadCharacter(name: string = "default"): Promise<Character> {
    try {
      // Check cache first
      if (this.characterCache.has(name)) {
        return this.characterCache.get(name)!;
      }

      // Load character file
      const filePath = path.join(__dirname, this.baseDir, `${name}.json`);
      console.log("filePath", filePath);
      const fileContent = await fs.readFile(filePath, "utf8");
      const character = JSON.parse(fileContent) as Character;

      // Validate character configuration
      this.validateCharacter(character);

      // Cache the character
      this.characterCache.set(name, character);
      log(`Loaded character configuration: ${name}`);

      return character;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Character configuration not found: ${name}`);
      }
      throw new Error(
        `Error loading character configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async reloadCharacter(name: string = "default"): Promise<Character> {
    // Clear cache for this character
    this.characterCache.delete(name);
    return this.loadCharacter(name);
  }

  private validateCharacter(character: Character): void {
    // Validate required fields exist
    const requiredFields = [
      "name",
      "system",
      "bio",
      "lore",
      "knowledge",
      "messageExamples",
      "postExamples",
      "adjectives",
      "topics",
      "style"
    ] as const;

    const missingFields = requiredFields.filter(
      (field) => !(field in character)
    );

    if (missingFields.length > 0) {
      throw new Error(
        `Invalid character configuration. Missing fields: ${missingFields.join(", ")}`
      );
    }

    // Validate style structure
    if (
      !character.style?.all ||
      !character.style?.chat ||
      !character.style?.post
    ) {
      throw new Error(
        "Invalid character configuration: style must contain all, chat, and post arrays"
      );
    }

    // Validate arrays are not empty
    type ArrayField = keyof Pick<
      Character,
      "bio" | "lore" | "knowledge" | "postExamples" | "adjectives" | "topics"
    >;
    const arrayFields: ArrayField[] = [
      "bio",
      "lore",
      "knowledge",
      "postExamples",
      "adjectives",
      "topics"
    ];

    const emptyArrays = arrayFields.filter((field) => {
      const value = character[field];
      return !Array.isArray(value) || value.length === 0;
    });

    // Validate style arrays
    if (
      !Array.isArray(character.style.all) ||
      character.style.all.length === 0
    ) {
      throw new Error(
        "Invalid character configuration: style.all must be a non-empty array"
      );
    }
    if (
      !Array.isArray(character.style.chat) ||
      character.style.chat.length === 0
    ) {
      throw new Error(
        "Invalid character configuration: style.chat must be a non-empty array"
      );
    }
    if (
      !Array.isArray(character.style.post) ||
      character.style.post.length === 0
    ) {
      throw new Error(
        "Invalid character configuration: style.post must be a non-empty array"
      );
    }

    // Validate messageExamples array
    if (
      !Array.isArray(character.messageExamples) ||
      character.messageExamples.length === 0
    ) {
      throw new Error(
        "Invalid character configuration: messageExamples must be a non-empty array"
      );
    }
  }

  async listCharacters(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.baseDir);
      return files
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.replace(".json", ""));
    } catch (error) {
      log("Error listing character configurations:", error);
      return [];
    }
  }

  clearCache(): void {
    this.characterCache.clear();
  }
}

// Usage example:
export async function initializeCharacter(
  name: string = "default"
): Promise<Character> {
  const loader = new CharacterLoader();

  try {
    const character = await loader.loadCharacter(name);
    log(`Successfully loaded character: ${character.name}`);
    return character;
  } catch (error) {
    log("Error initializing character:", error);
    throw error;
  }
}
