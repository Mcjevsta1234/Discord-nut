/**
 * Debug Mode System
 * 
 * Controls what information is displayed in bot responses:
 * - FULL: All info (routing, tokens, pricing, timing, tools, reasoning)
 * - SIMPLE: Plan, Tools, Performance only
 * - OFF: No system embed, chat response only
 * 
 * Settings are persisted per guild/channel.
 */

export enum DebugMode {
  FULL = 'full',
  SIMPLE = 'simple',
  OFF = 'off',
}

/**
 * In-memory storage for debug mode settings
 * Key: guildId or channelId (for DMs)
 */
const debugModeSettings = new Map<string, DebugMode>();

/**
 * Get debug mode for a guild/channel
 * Defaults to FULL if not set
 */
export function getDebugMode(guildId?: string, channelId?: string): DebugMode {
  const key = guildId || channelId || 'default';
  return debugModeSettings.get(key) || DebugMode.FULL;
}

/**
 * Set debug mode for a guild/channel
 */
export function setDebugMode(mode: DebugMode, guildId?: string, channelId?: string): void {
  const key = guildId || channelId || 'default';
  debugModeSettings.set(key, mode);
  console.log(`🐛 Debug mode set to ${mode.toUpperCase()} for ${key}`);
}

/**
 * Check if a specific section should be shown based on debug mode
 */
export function shouldShowSection(section: DebugSection, mode: DebugMode): boolean {
  switch (mode) {
    case DebugMode.OFF:
      return false; // No sections shown
    
    case DebugMode.SIMPLE:
      // Only show essential sections
      return [
        DebugSection.PLAN,
        DebugSection.TOOLS_USED,
        DebugSection.PERFORMANCE,
      ].includes(section);
    
    case DebugMode.FULL:
      return true; // All sections shown
    
    default:
      return true;
  }
}

/**
 * Debug sections that can be shown/hidden
 */
export enum DebugSection {
  PLAN = 'plan',
  REASONING = 'reasoning',
  TOOLS_USED = 'tools_used',
  ROUTING = 'routing',
  TOKEN_USAGE = 'token_usage',
  PRICING = 'pricing',
  PERFORMANCE = 'performance',
}

/**
 * Parse debug mode from string (case-insensitive)
 */
export function parseDebugMode(input: string): DebugMode | null {
  const normalized = input.toLowerCase().trim();
  
  switch (normalized) {
    case 'full':
      return DebugMode.FULL;
    case 'simple':
      return DebugMode.SIMPLE;
    case 'off':
      return DebugMode.OFF;
    default:
      return null;
  }
}

/**
 * Get all available debug modes
 */
export function getAllDebugModes(): DebugMode[] {
  return [DebugMode.FULL, DebugMode.SIMPLE, DebugMode.OFF];
}

/**
 * Get debug mode description
 */
export function getDebugModeDescription(mode: DebugMode): string {
  switch (mode) {
    case DebugMode.FULL:
      return 'All information (routing, tokens, pricing, timing, tools, reasoning)';
    case DebugMode.SIMPLE:
      return 'Plan, Tools Used, and Performance only';
    case DebugMode.OFF:
      return 'No system embed, chat response only';
    default:
      return 'Unknown mode';
  }
}
