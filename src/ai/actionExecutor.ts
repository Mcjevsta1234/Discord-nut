/**
 * Action Executor
 * Executes planned actions sequentially and aggregates results
 */

import { PlannedAction } from './planner';
import { OpenRouterService, Message } from './openRouterService';
import { ToolExecutionMetadata } from './llmMetadata';
import { ImageService } from './imageService';
import { AttachmentBuilder, Message as DiscordMessage } from 'discord.js';
import { PromptNormalizer } from './promptNormalizer';

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
  toolExecutions: ToolExecutionMetadata[]; // Track tool timing separately
}

/**
 * Callback for action execution progress
 */
export type ActionProgressCallback = (update: {
  actionIndex: number;
  totalActions: number;
  action: PlannedAction;
  status: 'starting' | 'completed' | 'failed';
  result?: ActionResult;
}) => void | Promise<void>;

export class ActionExecutor {
  private aiService: OpenRouterService;
  private imageService: ImageService;

  constructor(aiService: OpenRouterService) {
    this.aiService = aiService;
    this.imageService = new ImageService();
  }

  async executeActions(
    actions: PlannedAction[],
    progressCallback?: ActionProgressCallback
  ): Promise<ExecutionResult> {
    const results: ActionResult[] = [];
    const toolExecutions: ToolExecutionMetadata[] = [];
    let hasImage = false;
    let imageData: ExecutionResult['imageData'];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      console.log(`Executing action ${i + 1}/${actions.length}: ${action.type}${action.toolName ? ` (${action.toolName})` : ''}`);

      // Report starting
      if (progressCallback) {
        await progressCallback({
          actionIndex: i,
          totalActions: actions.length,
          action,
          status: 'starting',
        });
      }

      // Track tool execution timing
      const toolStartTime = action.type === 'tool' ? Date.now() : undefined;
      const result = await this.executeAction(action);
      
      // Record tool execution metadata if this was a tool action
      if (action.type === 'tool' && toolStartTime && action.toolName) {
        const toolEndTime = Date.now();
        toolExecutions.push({
          toolName: action.toolName,
          startTimeMs: toolStartTime,
          endTimeMs: toolEndTime,
          latencyMs: toolEndTime - toolStartTime,
          success: result.success,
        });
      }
      
      results.push(result);

      // Report completion
      if (progressCallback) {
        await progressCallback({
          actionIndex: i,
          totalActions: actions.length,
          action,
          status: result.success ? 'completed' : 'failed',
          result,
        });
      }

      if (result.success && result.imageBuffer) {
        hasImage = true;
        imageData = {
          buffer: result.imageBuffer,
          resolution: result.resolution!,
          prompt: result.prompt || action.imagePrompt || 'Generated image',
        };
      }
    }

    return { results, hasImage, imageData, toolExecutions };
  }

  async executeAction(action: PlannedAction): Promise<ActionResult> {
    console.log('🔧 ActionExecutor executing:', { type: action.type, toolName: action.toolName, params: action.toolParams });
    try {
      if (action.type === 'tool' && action.toolName) {
        console.log(`🛠️ Calling tool: ${action.toolName}`);
        return await this.executeTool(action);
      } else if (action.type === 'image') {
        return await this.executeImageGeneration(action);
      } else if (action.type === 'chat') {
        // Chat action is handled by final response generation
        return {
          success: true,
          content: '',
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
      // Normalize tool parameters if they contain user text
      let params = action.toolParams || {};
      
      // For tools with text inputs (query, search terms, etc.), normalize them
      if (params.query && typeof params.query === 'string') {
        const normalized = PromptNormalizer.normalizeForTool(params.query, action.toolName || 'unknown');
        if (normalized.wasNormalized) {
          console.log(`📝 Tool param normalized: "${normalized.original.substring(0, 30)}..." -> "${normalized.normalized.substring(0, 30)}..."`);
          params = { ...params, query: normalized.normalized };
        }
      }
      
      const toolResult = await this.aiService.executeMCPTool(
        action.toolName!,
        params
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

      // Normalize prompt before sending to image model
      // Handles cases where planner passed raw user message
      const normalizedPrompt = PromptNormalizer.normalizeForImage(action.imagePrompt);
      
      if (normalizedPrompt.wasNormalized) {
        console.log(`📝 Image prompt normalized in executor: "${normalizedPrompt.original.substring(0, 40)}..." -> "${normalizedPrompt.normalized.substring(0, 40)}..."`);
      }

      const result = await this.imageService.generateImage({
        prompt: normalizedPrompt.normalized,
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
