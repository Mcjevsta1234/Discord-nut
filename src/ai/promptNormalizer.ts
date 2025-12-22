/**
 * PromptNormalizer - Extracts clean, task-focused prompts
 * 
 * Removes conversational filler, persona names, and command phrases
 * to produce minimal, semantic-only prompts for models and tools.
 * 
 * Used by:
 * - Image generation (remove "hey emma generate an image of...")
 * - Tool calls (extract only parameters)
 * - Any model call requiring clean input
 */

export interface NormalizedPrompt {
  /** Clean, minimal prompt for the task */
  normalized: string;
  /** Original user message (fallback) */
  original: string;
  /** Whether normalization was applied */
  wasNormalized: boolean;
}

export class PromptNormalizer {
  /**
   * Normalize a user message for image generation
   * Removes greetings, persona names, command phrases
   * Keeps only the descriptive content
   */
  static normalizeForImage(userMessage: string): NormalizedPrompt {
    const original = userMessage;
    let normalized = userMessage;

    // Strip common persona names (case-insensitive, with word boundaries)
    const personaNames = ['emma', 'steve', 'karen', 'chad', 'alex'];
    for (const name of personaNames) {
      const regex = new RegExp(`\\b${name}\\b`, 'gi');
      normalized = normalized.replace(regex, '');
    }

    // Strip greetings
    const greetings = [
      /\b(hey|hi|hello|yo|sup|wassup|heya|hiya)\b/gi,
      /\bgood\s+(morning|afternoon|evening|night)\b/gi,
    ];
    for (const pattern of greetings) {
      normalized = normalized.replace(pattern, '');
    }

    // Strip command phrases for image generation
    const imageCommands = [
      /\b(generate|create|draw|make|give me|show me|can you)\s+(an?\s+)?(image|picture|pic|photo|art|drawing|illustration|visual)\s+(of|showing|with)?\b/gi,
      /\b(please\s+)?(generate|create|draw|make|paint|sketch|render|visuali[sz]e)\s+(me\s+)?(an?\s+)?(image|picture|pic|photo|art)?\s+(of|showing|with)?\b/gi,
      /\bimage\s+of\b/gi,
      /\bpicture\s+of\b/gi,
    ];
    for (const pattern of imageCommands) {
      normalized = normalized.replace(pattern, '');
    }

    // Strip politeness markers
    const politeness = [
      /\b(please|kindly|thanks|thank you)\b/gi,
      /\b(could you|can you|would you)\b/gi,
      /\bi want\b/gi,
      /\bi need\b/gi,
    ];
    for (const pattern of politeness) {
      normalized = normalized.replace(pattern, '');
    }

    // Clean up whitespace
    normalized = normalized
      .replace(/\s+/g, ' ') // Multiple spaces to single
      .replace(/^\s+|\s+$/g, '') // Trim start/end
      .replace(/^[,\s]+|[,\s]+$/g, ''); // Remove leading/trailing commas and spaces

    // Safety: If normalization removed too much, use original
    if (normalized.length < 5 || normalized.split(/\s+/).length < 2) {
      return {
        normalized: original,
        original,
        wasNormalized: false,
      };
    }

    // Enhance descriptive quality for image generation
    normalized = this.enhanceImagePrompt(normalized);

    return {
      normalized,
      original,
      wasNormalized: normalized !== original,
    };
  }

  /**
   * Normalize for tool calls
   * Extracts only the parameter-relevant content
   */
  static normalizeForTool(userMessage: string, toolName: string): NormalizedPrompt {
    const original = userMessage;
    let normalized = userMessage;

    // Strip persona names
    const personaNames = ['emma', 'steve', 'karen', 'chad', 'alex'];
    for (const name of personaNames) {
      const regex = new RegExp(`\\b${name}\\b`, 'gi');
      normalized = normalized.replace(regex, '');
    }

    // Strip greetings
    const greetings = [
      /\b(hey|hi|hello|yo|sup)\b/gi,
      /\bgood\s+(morning|afternoon|evening|night)\b/gi,
    ];
    for (const pattern of greetings) {
      normalized = normalized.replace(pattern, '');
    }

    // Strip tool command phrases based on tool type
    const toolCommandPatterns: Record<string, RegExp[]> = {
      calculate: [
        /\b(calculate|compute|what'?s|solve|work out|figure out|tell me)\b/gi,
      ],
      convert_units: [
        /\b(convert|change|turn|transform)\b/gi,
        /\bto\b/gi, // Keep 'to' for "6ft to cm"
      ],
      get_time: [
        /\b(what'?s? the|tell me the|give me the|show me the|get the)\b/gi,
        /\b(time|date)\b/gi,
      ],
      web_search: [
        /\b(search|look up|find|google)\b/gi,
      ],
    };

    const patterns = toolCommandPatterns[toolName] || [];
    for (const pattern of patterns) {
      normalized = normalized.replace(pattern, '');
    }

    // Clean up whitespace
    normalized = normalized
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '')
      .replace(/^[,\s]+|[,\s]+$/g, '');

    // Safety: Use original if too short
    if (normalized.length < 2) {
      return {
        normalized: original,
        original,
        wasNormalized: false,
      };
    }

    return {
      normalized,
      original,
      wasNormalized: normalized !== original,
    };
  }

  /**
   * Enhance image prompts with quality improvements
   * Makes prompts more descriptive for better image generation
   */
  private static enhanceImagePrompt(prompt: string): string {
    // Don't enhance if it's already detailed (>100 chars)
    if (prompt.length > 100) {
      return prompt;
    }

    // Add stylistic guidance for very short prompts
    if (prompt.split(/\s+/).length <= 3) {
      return `${prompt}, high quality, detailed`;
    }

    return prompt;
  }

  /**
   * Normalize for chat responses
   * Keeps conversational tone but removes redundant filler
   * Less aggressive than image/tool normalization
   */
  static normalizeForChat(userMessage: string): NormalizedPrompt {
    const original = userMessage;
    let normalized = userMessage;

    // Only remove excessive repetition and weird formatting
    normalized = normalized
      .replace(/(.)\1{4,}/g, '$1$1$1') // Limit repeated chars to 3
      .replace(/\s+/g, ' ') // Multiple spaces to single
      .trim();

    return {
      normalized,
      original,
      wasNormalized: normalized !== original,
    };
  }

  /**
   * Smart normalization - chooses the appropriate strategy
   */
  static normalize(userMessage: string, context: 'image' | 'tool' | 'chat', toolName?: string): NormalizedPrompt {
    switch (context) {
      case 'image':
        return this.normalizeForImage(userMessage);
      case 'tool':
        return this.normalizeForTool(userMessage, toolName || 'unknown');
      case 'chat':
        return this.normalizeForChat(userMessage);
      default:
        return {
          normalized: userMessage,
          original: userMessage,
          wasNormalized: false,
        };
    }
  }
}
