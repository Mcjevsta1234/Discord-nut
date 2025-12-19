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
   * Generate an image using OpenRouter (Gemini image generation)
   */
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    try {
      const resolution = {
        width: request.width || 512,
        height: request.height || 512,
      };

      console.log(`Generating image: "${request.prompt}" at ${resolution.width}x${resolution.height}`);

      // For OpenRouter image generation, we need to explicitly request image output
      // Use a prompt that clearly indicates we want an image, with size specification
      const imagePrompt = `${request.prompt} [Image size: ${resolution.width}x${resolution.height}]`;
      
      const response = await this.client.post('/chat/completions', {
        model: config.image.model,
        messages: [
          {
            role: 'user',
            content: imagePrompt,
          },
        ],
        // Request image output format explicitly
        response_format: { type: 'image' },
        // Image generation parameters
        temperature: 0.7,
        max_tokens: 2048,
      });

      console.log('OpenRouter response received');
      console.log('Response structure:', JSON.stringify(response.data, null, 2).substring(0, 500));

      const choice = response.data?.choices?.[0];
      if (!choice) {
        throw new Error('No choices in OpenRouter response');
      }

      let imageBuffer: Buffer | null = null;

      // Check multiple possible locations for image data in the response
      // 1. Check if there's an image field directly in the choice
      if (choice.image) {
        console.log('Found image field in choice');
        imageBuffer = Buffer.from(choice.image, 'base64');
      }
      // 2. Check message.image field
      else if (choice.message?.image) {
        console.log('Found image field in message');
        imageBuffer = Buffer.from(choice.message.image, 'base64');
      }
      // 3. Check for content array with image type
      else if (Array.isArray(choice.message?.content)) {
        console.log('Message content is array, checking for image parts');
        const imagePart = choice.message.content.find((part: any) => 
          part.type === 'image' || part.type === 'image_url'
        );
        if (imagePart) {
          if (imagePart.image) {
            imageBuffer = Buffer.from(imagePart.image, 'base64');
          } else if (imagePart.image_url?.url) {
            const base64Match = imagePart.image_url.url.match(/base64,(.+)/);
            if (base64Match) {
              imageBuffer = Buffer.from(base64Match[1], 'base64');
            }
          }
        }
      }
      // 4. Try to extract from message.content string
      else if (typeof choice.message?.content === 'string') {
        const content = choice.message.content;
        
        // Try to extract base64 data URL
        const dataUrlMatch = content.match(/data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+\/=]+)/i);
        if (dataUrlMatch) {
          console.log('Found base64 data URL in message content');
          imageBuffer = Buffer.from(dataUrlMatch[2], 'base64');
        } 
        // Try pure base64 (no data URL prefix) - must be very long to avoid false positives
        else if (/^[A-Za-z0-9+\/=]{500,}$/.test(content.trim())) {
          console.log('Found pure base64 string in message content');
          imageBuffer = Buffer.from(content.trim(), 'base64');
        } 
        else {
          console.error('No image data found. Model returned text. Response:', content.substring(0, 300));
          throw new Error(
            `Image model returned text instead of image data.\n` +
            `This model may not support image generation, or the request format is incorrect.\n` +
            `Response: "${content.substring(0, 150)}..."\n` +
            `Try using a different image generation model.`
          );
        }
      } else {
        throw new Error('Unexpected response format - no message content or image data found');
      }

      if (!imageBuffer) {
        throw new Error('Failed to extract image data from response. The model may have returned text only.');
      }

      // Validate the image buffer
      if (imageBuffer.length < 100) {
        throw new Error(`Image data too small (${imageBuffer.length} bytes). Likely not a valid image.`);
      }

      console.log(`Successfully extracted image data: ${imageBuffer.length} bytes`);

      // Resize to requested resolution
      const resizedBuffer = await this.resizeImage(imageBuffer, resolution.width, resolution.height);

      // Ensure Discord-safe size
      const finalBuffer = await this.ensureDiscordSafe(resizedBuffer, resolution);

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
