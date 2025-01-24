import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { doc, setDoc, getDoc, deleteDoc } from "firebase/firestore";
import { storage, db } from "../config/firebase";

export class StorageService {
  async uploadImage(imageBuffer: Buffer, imageId: string): Promise<string> {
    try {
      const imageRef = ref(storage, `images/${imageId}.png`);
      const response = await uploadBytes(imageRef, imageBuffer);
      return await getDownloadURL(response.ref);
    } catch (error) {
      console.error("Error uploading image:", error);
      throw new Error("Failed to upload image to storage");
    }
  }

  async uploadMetadata(metadata: any, imageId: string): Promise<string> {
    try {
      const metadataRef = ref(storage, `metadata/${imageId}.json`);
      const metadataBlob = new Blob([JSON.stringify(metadata)], {
        type: "application/json"
      });
      const response = await uploadBytes(metadataRef, metadataBlob);
      return await getDownloadURL(response.ref);
    } catch (error) {
      console.error("Error uploading metadata:", error);
      throw new Error("Failed to upload metadata to storage");
    }
  }

  async cacheExists(key: string): Promise<boolean> {
    try {
      const cacheRef = doc(db, "cache", key);
      const snapshot = await getDoc(cacheRef);
      if (!snapshot.exists()) return false;

      const data = snapshot.data() as any;
      // Consider cache entries older than 24 hours as expired
      const isExpired = Date.now() - data.timestamp > 24 * 60 * 60 * 1000;

      if (isExpired) {
        await this.deleteCache(key);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error checking cache:", error);
      return false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      // Split the key into collection and document ID
      const [collection, docId] = key.split("/");
      const docRef = doc(db, collection, docId);
      const snapshot = await getDoc(docRef);

      if (!snapshot.exists()) return null;
      return snapshot.data() as T;
    } catch (error) {
      console.error("Error getting data:", error);
      return null;
    }
  }

  async set(key: string, value: any): Promise<void> {
    try {
      // Split the key into collection and document ID
      const [collection, docId] = key.split("/");
      const docRef = doc(db, collection, docId);
      await setDoc(docRef, value);
    } catch (error) {
      console.error("Error setting data:", error);
      throw new Error("Failed to set data in database");
    }
  }

  async setCache(key: string, value: any): Promise<void> {
    try {
      const cacheRef = doc(db, "cache", key);
      await setDoc(cacheRef, {
        value,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error("Error setting cache:", error);
      throw new Error("Failed to set cache in database");
    }
  }

  private async deleteCache(key: string): Promise<void> {
    try {
      const cacheRef = doc(db, "cache", key);
      await deleteDoc(cacheRef);
    } catch (error) {
      console.error("Error deleting cache:", error);
    }
  }
}
