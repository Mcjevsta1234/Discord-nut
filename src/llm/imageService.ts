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
   * Generate an image using OpenRouter with chat.completions
   */
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    try {
      const resolution = {
        width: request.width || 512,
        height: request.height || 512,
      };

      console.log(`Generating image: "${request.prompt}" at ${resolution.width}x${resolution.height}`);

      // Request image generation through OpenRouter chat.completions
      const imagePrompt = `${request.prompt}`;
      
      const response = await this.client.post('/chat/completions', {
        model: config.image.model,
        messages: [
          {
            role: 'user',
            content: imagePrompt,
          },
        ],
        // Request image output modality
        modalities: ['image', 'text'],
        temperature: 0.7,
        max_tokens: 2048,
      });

      console.log('OpenRouter response received');
      console.log('Response structure:', JSON.stringify(response.data, null, 2).substring(0, 1000));

      const choice = response.data?.choices?.[0];
      if (!choice) {
        throw new Error('No choices in OpenRouter response');
      }

      let imageBuffer: Buffer | null = null;

      // Check for message.images array (OpenRouter format for Flux and similar models)
      if (choice.message?.images && Array.isArray(choice.message.images) && choice.message.images.length > 0) {
        console.log(`Found ${choice.message.images.length} images in message.images array`);
        const firstImage = choice.message.images[0];
        
        // Check for image_url.url (URL format)
        if (firstImage.image_url?.url) {
          const imageUrl = firstImage.image_url.url;
          console.log('Image URL found, downloading:', imageUrl);
          
          // Download the image
          const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
          imageBuffer = Buffer.from(imageResponse.data);
          console.log(`Downloaded image: ${imageBuffer.length} bytes`);
        }
        // Check for base64 data
        else if (firstImage.b64_json) {
          console.log('Found b64_json in image');
          imageBuffer = Buffer.from(firstImage.b64_json, 'base64');
        }
        else if (firstImage.image_base64) {
          console.log('Found image_base64 in image');
          imageBuffer = Buffer.from(firstImage.image_base64, 'base64');
        }
      }
      // Fallback: Check other possible locations
      else if (choice.image) {
        console.log('Found image field in choice');
        imageBuffer = Buffer.from(choice.image, 'base64');
      }
      else if (choice.message?.image) {
        console.log('Found image field in message');
        imageBuffer = Buffer.from(choice.message.image, 'base64');
      }
      else if (Array.isArray(choice.message?.content)) {
        console.log('Message content is array, checking for image parts');
        const imagePart = choice.message.content.find((part: any) => 
          part.type === 'image' || part.type === 'image_url'
        );
        if (imagePart) {
          if (imagePart.image) {
            imageBuffer = Buffer.from(imagePart.image, 'base64');
          } else if (imagePart.image_url?.url) {
            // Download from URL
            const imageResponse = await axios.get(imagePart.image_url.url, { responseType: 'arraybuffer' });
            imageBuffer = Buffer.from(imageResponse.data);
          }
        }
      }
      else if (typeof choice.message?.content === 'string') {
        const content = choice.message.content;
        
        // Try to extract base64 data URL
        const dataUrlMatch = content.match(/data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+\/=]+)/i);
        if (dataUrlMatch) {
          console.log('Found base64 data URL in message content');
          imageBuffer = Buffer.from(dataUrlMatch[2], 'base64');
        } 
        // Try pure base64 - must be very long to avoid false positives
        else if (/^[A-Za-z0-9+\/=]{500,}$/.test(content.trim())) {
          console.log('Found pure base64 string in message content');
          imageBuffer = Buffer.from(content.trim(), 'base64');
        } 
        else {
          console.error('No image data found. Model returned text. Response:', content.substring(0, 300));
          throw new Error(
            `Image model returned text instead of image data.\n` +
            `Response: "${content.substring(0, 150)}..."\n` +
            `Check if the model supports image generation.`
          );
        }
      } else {
        throw new Error('Unexpected response format - no message.images, content, or image data found');
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
