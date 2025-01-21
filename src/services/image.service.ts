import { StorageService } from "./storage.service";

export class ImageService {
  private storage: StorageService;

  constructor() {
    this.storage = new StorageService();
  }

  async store(imageId: string, dataUri: string): Promise<string> {
    try {
      // Convert data URI to buffer
      const base64Data = dataUri.replace(/^data:image\/png;base64,/, "");
      const imageBuffer = Buffer.from(base64Data, "base64");

      // Upload to Firebase Storage
      const imageUrl = await this.storage.uploadImage(imageBuffer, imageId);

      // Cache the URL
      await this.storage.setCache(`image:${imageId}`, {
        url: imageUrl,
        createdAt: Date.now()
      });

      return imageUrl;
    } catch (error) {
      console.error("Error generating image:", error);
      throw new Error("Failed to generate and store image");
    }
  }

  async getExistingImage(imageId: string): Promise<string | null> {
    try {
      const cached: any = await this.storage.get(`image:${imageId}`);
      return cached ? cached.url : null;
    } catch (error) {
      console.error("Error getting existing image:", error);
      return null;
    }
  }
}
