/**
 * Action Executor
 * Executes planned actions sequentially and aggregates results
 */

import { PlannedAction } from './planner';
import { OpenRouterService, Message } from './openRouterService';
import { ImageService } from './imageService';
import { AttachmentBuilder, Message as DiscordMessage } from 'discord.js';

export interface ActionResult {
  success: boolean;
  content: string;
  data?: any;
  imageBuffer?: Buffer;
  resolution?: { width: number; height: number };
  prompt?: string;
  error?: string;
}

export interface ExecutionResult {
  results: ActionResult[];
  hasImage: boolean;
  imageData?: {
    buffer: Buffer;
    resolution: { width: number; height: number };
    prompt: string;
  };
}

export class ActionExecutor {
  private aiService: OpenRouterService;
  private imageService: ImageService;

  constructor(aiService: OpenRouterService) {
    this.aiService = aiService;
    this.imageService = new ImageService();
  }

  async executeActions(actions: PlannedAction[]): Promise<ExecutionResult> {
    const results: ActionResult[] = [];
    let hasImage = false;
    let imageData: ExecutionResult['imageData'];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      console.log(`Executing action ${i + 1}/${actions.length}: ${action.type}${action.toolName ? ` (${action.toolName})` : ''}`);

      const result = await this.executeAction(action);
      results.push(result);

      if (result.success && result.imageBuffer) {
        hasImage = true;
        imageData = {
          buffer: result.imageBuffer,
          resolution: result.resolution!,
          prompt: result.prompt || action.imagePrompt || 'Generated image',
        };
      }
    }

    return { results, hasImage, imageData };
  }

  /**
   * Execute a single action
   */
  async executeAction(action: PlannedAction): Promise<ActionResult> {
    try {
      if (action.type === 'tool' && action.toolName) {
        return await this.executeTool(action);
      } else if (action.type === 'image') {
        return await this.executeImageGeneration(action);
      } else if (action.type === 'chat') {
        // Chat action is handled by final response generation
        return {
          success: true,
          content: 'Chat response will be generated',
        };
      }

      return {
        success: false,
        content: '',
        error: `Unknown action type: ${action.type}`,
      };
    } catch (error) {
      console.error('Error executing action:', error);
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async executeTool(action: PlannedAction): Promise<ActionResult> {
    try {
      const toolResult = await this.aiService.executeMCPTool(
        action.toolName!,
        action.toolParams || {}
      );

      if (!toolResult) {
        return {
          success: false,
          content: '',
          error: `Tool ${action.toolName} returned no result`,
        };
      }

      // Extract content from tool result
      let content = '';
      if (typeof toolResult === 'string') {
        content = toolResult;
      } else if (toolResult.success && toolResult.data) {
        content = typeof toolResult.data === 'string' 
          ? toolResult.data 
          : JSON.stringify(toolResult.data, null, 2);
      } else if (toolResult.error) {
        return {
          success: false,
          content: '',
          error: toolResult.error,
        };
      }

      return {
        success: true,
        content,
        data: toolResult,
      };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : 'Tool execution failed',
      };
    }
  }

  private async executeImageGeneration(action: PlannedAction): Promise<ActionResult> {
    try {
      if (!action.imagePrompt) {
        return {
          success: false,
          content: '',
          error: 'No image prompt provided',
        };
      }

      const result = await this.imageService.generateImage({
        prompt: action.imagePrompt,
        width: action.imageResolution?.width || 512,
        height: action.imageResolution?.height || 512,
      });

      return {
        success: true,
        content: `Generated image: ${result.resolution.width}×${result.resolution.height}`,
        imageBuffer: result.imageBuffer,
        resolution: result.resolution,
        prompt: action.imagePrompt,
      };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : 'Image generation failed',
      };
    }
  }
}
