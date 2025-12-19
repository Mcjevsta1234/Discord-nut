/**
 * Image Generation Service
 * Handles image generation with cost-aware routing and Discord-safe output
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import sharp from 'sharp';

export interface ImageGenerationRequest {
  prompt: string;
  width?: number;
  height?: number;
}

export interface ImageResolution {
  width: number;
  height: number;
}

export interface ImageGenerationResult {
  imageBuffer: Buffer;
  sizeBytes: number;
  resolution: ImageResolution;
}

export class ImageService {
  private client: AxiosInstance;
  private readonly MAX_DISCORD_SIZE = 8 * 1024 * 1024; // 8MB

  constructor() {
    this.client = axios.create({
      baseURL: config.openRouter.baseUrl,
      headers: {
        'Authorization': `Bearer ${config.openRouter.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Determine resolution based on user request
   */
  parseResolutionFromPrompt(prompt: string): ImageResolution {
    const promptLower = prompt.toLowerCase();

    // Check for explicit resolution requests
    if (promptLower.includes('128') || promptLower.includes('tiny')) {
      return { width: 128, height: 128 };
    }
    if (promptLower.includes('256') || promptLower.includes('small')) {
      return { width: 256, height: 256 };
    }
    if (promptLower.includes('768') || promptLower.includes('medium')) {
      return { width: 768, height: 768 };
    }
    if (promptLower.includes('1024') || promptLower.includes('large') || promptLower.includes('high quality')) {
      return { width: 1024, height: 1024 };
    }

    // Check for aspect ratios
    if (promptLower.includes('16:9') || promptLower.includes('widescreen') || promptLower.includes('landscape')) {
      if (promptLower.includes('1024') || promptLower.includes('large')) {
        return { width: 1024, height: 576 };
      }
      return { width: 768, height: 432 };
    }
    if (promptLower.includes('9:16') || promptLower.includes('portrait') || promptLower.includes('vertical')) {
      if (promptLower.includes('1024') || promptLower.includes('large')) {
        return { width: 576, height: 1024 };
      }
      return { width: 432, height: 768 };
    }
    if (promptLower.includes('banner') || promptLower.includes('wide banner')) {
      return { width: 1024, height: 256 };
    }

    // Default: 512x512
    return { width: 512, height: 512 };
  }

  /**
   * Generate an image using OpenRouter
   */
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    try {
      const resolution = {
        width: request.width || 512,
        height: request.height || 512,
      };

      console.log(`Generating image: ${request.prompt} at ${resolution.width}x${resolution.height}`);

      // For now, we'll use a placeholder approach since direct image generation
      // through OpenRouter may require specific model configurations
      // In production, you'd integrate with a proper image generation API

      // Create a simple placeholder image using sharp
      const placeholderBuffer = await sharp({
        create: {
          width: resolution.width,
          height: resolution.height,
          channels: 4,
          background: { r: 100, g: 150, b: 200, alpha: 1 },
        },
      })
        .png()
        .composite([
          {
            input: Buffer.from(
              `<svg width="${resolution.width}" height="${resolution.height}">
                <rect width="100%" height="100%" fill="rgb(100,150,200)"/>
                <text x="50%" y="50%" font-family="Arial" font-size="24" fill="white" text-anchor="middle">
                  Image Generation
                </text>
              </svg>`
            ),
            top: 0,
            left: 0,
          },
        ])
        .toBuffer();

      // Ensure Discord-safe size
      const finalBuffer = await this.ensureDiscordSafe(placeholderBuffer, resolution);

      return {
        imageBuffer: finalBuffer,
        sizeBytes: finalBuffer.length,
        resolution,
      };
    } catch (error) {
      console.error('Error generating image:', error);
      throw new Error(
        `Image generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Resize image to target dimensions
   */
  private async resizeImage(buffer: Buffer, width: number, height: number): Promise<Buffer> {
    return await sharp(buffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'center',
      })
      .png({ quality: 90 })
      .toBuffer();
  }

  /**
   * Ensure image is under Discord's size limit
   */
  private async ensureDiscordSafe(buffer: Buffer, resolution: ImageResolution): Promise<Buffer> {
    let currentBuffer = buffer;
    let quality = 90;

    // If already under limit, return as-is
    if (currentBuffer.length <= this.MAX_DISCORD_SIZE) {
      return currentBuffer;
    }

    console.log(`Image size ${currentBuffer.length} bytes exceeds Discord limit, compressing...`);

    // Try progressively lower quality
    while (quality >= 50 && currentBuffer.length > this.MAX_DISCORD_SIZE) {
      quality -= 10;
      currentBuffer = await sharp(buffer)
        .png({ quality, compressionLevel: 9 })
        .toBuffer();
      
      console.log(`Compressed to quality ${quality}: ${currentBuffer.length} bytes`);
    }

    // If still too large, try downscaling
    if (currentBuffer.length > this.MAX_DISCORD_SIZE) {
      const scaleFactor = Math.sqrt(this.MAX_DISCORD_SIZE / currentBuffer.length) * 0.9;
      const newWidth = Math.floor(resolution.width * scaleFactor);
      const newHeight = Math.floor(resolution.height * scaleFactor);

      console.log(`Downscaling to ${newWidth}x${newHeight}...`);
      
      currentBuffer = await sharp(buffer)
        .resize(newWidth, newHeight)
        .png({ quality: 80, compressionLevel: 9 })
        .toBuffer();
    }

    return currentBuffer;
  }

  /**
   * Check if image is under Discord size limit
   */
  isDiscordSafe(sizeBytes: number): boolean {
    return sizeBytes <= this.MAX_DISCORD_SIZE;
  }
}
