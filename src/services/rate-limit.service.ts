// src/services/rate-limit.service.ts

import { doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "../config/firebase";
import debug from "debug";

const log = debug("arok:rate-limit-service");

interface RateLimitEntry {
  userId: string;
  messageCount: number;
  lastReset: number;
  messages: string[]; // Array of message IDs
}

export class RateLimitService {
  private readonly COLLECTION = "rate_limits";
  private readonly MAX_MESSAGES_PER_HOUR = 1000;
  private readonly HOUR_IN_MS = 3600000; // 1 hour in milliseconds
  exceptions = ["system", "agent", "api-user", "plugin:"];

  async checkRateLimit(userId: string, messageId: string): Promise<boolean> {
    try {
      if (this.exceptions.includes(userId)) return true; // Allow system and agent messages
      const entry = await this.getRateLimitEntry(userId);
      const now = Date.now();

      // If no entry exists or it's been more than an hour, create/reset the entry
      if (!entry || now - entry.lastReset >= this.HOUR_IN_MS) {
        await this.resetRateLimit(userId, messageId);
        return true; // Allow the message
      }

      // Check if under the limit
      if (entry.messageCount < this.MAX_MESSAGES_PER_HOUR) {
        // Update the entry with the new message
        await this.updateRateLimit(entry, messageId);
        return true;
      }

      // Over the limit - save message ID but return false
      await this.updateRateLimit(entry, messageId, false);
      return false;
    } catch (error) {
      console.error("Error checking rate limit:", error);
      return false; // Fail closed
    }
  }

  private async getRateLimitEntry(
    userId: string
  ): Promise<RateLimitEntry | null> {
    try {
      const docRef = doc(db, this.COLLECTION, userId);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) return null;

      return docSnap.data() as RateLimitEntry;
    } catch (error) {
      console.error("Error getting rate limit entry:", error);
      return null;
    }
  }

  private async resetRateLimit(
    userId: string,
    messageId: string
  ): Promise<void> {
    try {
      const entry: RateLimitEntry = {
        userId,
        messageCount: 1,
        lastReset: Date.now(),
        messages: [messageId]
      };

      const docRef = doc(db, this.COLLECTION, userId);
      await setDoc(docRef, entry);
    } catch (error) {
      console.error("Error resetting rate limit:", error);
      throw error;
    }
  }

  private async updateRateLimit(
    entry: RateLimitEntry,
    messageId: string,
    incrementCount: boolean = true
  ): Promise<void> {
    try {
      const updatedEntry: RateLimitEntry = {
        ...entry,
        messageCount: incrementCount
          ? entry.messageCount + 1
          : entry.messageCount,
        messages: [...entry.messages, messageId]
      };

      const docRef = doc(db, this.COLLECTION, entry.userId);
      await setDoc(docRef, updatedEntry);
    } catch (error) {
      console.error("Error updating rate limit:", error);
      throw error;
    }
  }
}
