import {
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs
} from "firebase/firestore";
import { db } from "../config/firebase";
import type { Message } from "../types/message.types";
import debug from "debug";

const log = debug("arok:memory-service");

interface MemoryEntry extends Message {
  roomId: string;
  participants: string[];
}

export class MemoryService {
  private readonly COLLECTION = "memories";

  /**
   * Standardized method to add any type of memory entry
   */
  async addMemory(message: Message): Promise<string> {
    try {
      const entry: MemoryEntry = {
        id: message.id,
        roomId: message.id,
        participants: [message.author],
        author: message.author,
        type: message.type,
        content: message.content,
        createdAt: new Date().toISOString(),
        requestId: message.requestId,
        source: message.source,
        metadata: message.metadata
      };

      // If this is a reply, add original author to participants
      if (message.requestId) {
        const parentEntry = await this.getEntry(message.requestId);
        if (
          parentEntry &&
          !entry.participants.includes(parentEntry.participants[0])
        ) {
          entry.participants.push(parentEntry.participants[0]);
        }
      }
      log(`Adding memory entry: ${entry.roomId}`, entry);
      await setDoc(doc(db, this.COLLECTION, entry.roomId), entry);

      return entry.roomId;
    } catch (error) {
      console.error("Error adding memory:", error);
      throw error;
    }
  }

  /**
   * Gets a specific memory entry
   */
  async getEntry(roomId: string): Promise<MemoryEntry | null> {
    try {
      const docRef = doc(db, this.COLLECTION, roomId);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) return null;

      return docSnap.data() as MemoryEntry;
    } catch (error) {
      console.error("Error getting memory entry:", error);
      throw error;
    }
  }

  /**
   * Gets all entries involving a participant
   */
  async getParticipantHistory(participantId: string): Promise<MemoryEntry[]> {
    try {
      const q = query(
        collection(db, this.COLLECTION),
        where("participants", "array-contains", participantId),
        orderBy("createdAt", "desc")
      );

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map((doc) => doc.data() as MemoryEntry);
    } catch (error) {
      console.error("Error getting participant history:", error);
      throw error;
    }
  }

  /**
   * Gets all entries in a conversation thread
   */
  async getThread(rootId: string): Promise<MemoryEntry[]> {
    try {
      const entries: MemoryEntry[] = [];

      // Get root entry
      const rootEntry = await this.getEntry(rootId);
      if (!rootEntry) return [];

      entries.push(rootEntry);

      // Get all replies referencing this root
      const q = query(
        collection(db, this.COLLECTION),
        where("requestId", "==", rootId),
        orderBy("createdAt", "asc")
      );

      const querySnapshot = await getDocs(q);
      entries.push(
        ...querySnapshot.docs.map((doc) => doc.data() as MemoryEntry)
      );

      return entries;
    } catch (error) {
      console.error("Error getting thread:", error);
      throw error;
    }
  }

  /**
   * Gets recent conversation context for a participant
   */
  async getRecentContext(
    participantId: string,
    limit = 10
  ): Promise<MemoryEntry[]> {
    try {
      const q = query(
        collection(db, this.COLLECTION),
        where("participants", "array-contains", participantId),
        orderBy("createdAt", "desc")
      );

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs
        .map((doc) => doc.data() as MemoryEntry)
        .slice(0, limit);
    } catch (error) {
      console.error("Error getting recent context:", error);
      throw error;
    }
  }
}
