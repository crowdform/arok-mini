import { generate } from "text-to-image";
import { StorageService } from "./storage.service";

type Tweet = {
  id: string;
  text: string;
};
export class ImageService {
  private storage: StorageService;
  private readonly defaultConfig = {
    maxWidth: 1024,
    fontSize: 24,
    lineHeight: 30,
    margin: 20,
    bgColor: "#ffffff",
    textColor: "#000000",
    fontFamily: "Arial",
    customHeight: 400
  };

  constructor() {
    this.storage = new StorageService();
  }

  async generateAndStore(
    tweet: Tweet,
    config = this.defaultConfig
  ): Promise<string> {
    try {
      // Generate the image
      const dataUri = await generate(tweet.text, {
        ...this.defaultConfig,
        ...config
      });

      // Convert data URI to buffer
      const base64Data = dataUri.replace(/^data:image\/png;base64,/, "");
      const imageBuffer = Buffer.from(base64Data, "base64");

      // Upload to Firebase Storage
      const imageUrl = await this.storage.uploadImage(imageBuffer, tweet.id);

      // Cache the URL
      await this.storage.setCache(`image:${tweet.id}`, {
        url: imageUrl,
        createdAt: Date.now()
      });

      return imageUrl;
    } catch (error) {
      console.error("Error generating image:", error);
      throw new Error("Failed to generate and store image");
    }
  }

  async getExistingImage(tweetId: string): Promise<string | null> {
    try {
      const cached: any = await this.storage.get(`nfts/image:${tweetId}`);
      return cached ? cached.url : null;
    } catch (error) {
      console.error("Error getting existing image:", error);
      return null;
    }
  }
}
