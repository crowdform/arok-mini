import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp
} from "firebase/firestore";
import { db } from "../config/firebase";

interface CacheEntry {
  key: string;
  value: any;
  updatedAt: number;
  metadata?: Record<string, any>;
}

export class CacheService {
  private readonly COLLECTION = "cache";

  /**
   * Sets a cache entry
   */
  async set(
    key: string,
    value: any,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const entry: CacheEntry = {
        key,
        value,
        updatedAt: Date.now(),
        metadata
      };

      await setDoc(doc(db, this.COLLECTION, key), entry);
    } catch (error) {
      console.error("Error setting cache entry:", error);
      throw error;
    }
  }

  /**
   * Gets a cache entry by key
   */
  async get(key: string): Promise<any | null> {
    try {
      const docRef = doc(db, this.COLLECTION, key);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) return null;

      const entry = docSnap.data() as CacheEntry;
      return entry.value;
    } catch (error) {
      console.error("Error getting cache entry:", error);
      throw error;
    }
  }

  /**
   * Updates an existing cache entry
   */
  async update(
    key: string,
    value: any,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const docRef = doc(db, this.COLLECTION, key);
      const updateData: Partial<CacheEntry> = {
        value,
        updatedAt: Date.now()
      };

      if (metadata) {
        updateData.metadata = metadata;
      }

      await updateDoc(docRef, updateData);
    } catch (error) {
      console.error("Error updating cache entry:", error);
      throw error;
    }
  }

  /**
   * Gets entries by metadata field value
   */
  async getByMetadata(field: string, value: any): Promise<CacheEntry[]> {
    try {
      const q = query(
        collection(db, this.COLLECTION),
        where(`metadata.${field}`, "==", value),
        orderBy("updatedAt", "desc")
      );

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map((doc) => doc.data() as CacheEntry);
    } catch (error) {
      console.error("Error getting entries by metadata:", error);
      throw error;
    }
  }

  /**
   * Gets most recently updated entries
   */
  async getRecent(limit = 10): Promise<CacheEntry[]> {
    try {
      const q = query(
        collection(db, this.COLLECTION),
        orderBy("updatedAt", "desc")
      );

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs
        .map((doc) => doc.data() as CacheEntry)
        .slice(0, limit);
    } catch (error) {
      console.error("Error getting recent entries:", error);
      throw error;
    }
  }
}
