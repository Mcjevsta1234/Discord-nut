/**
 * PART B: Preset loader - maps project types to cached prompt presets
 */

import * as static_html from './static_html';
import * as web_app_node from './web_app_node';
import * as discord_bot from './discord_bot';
import * as node_cli from './node_cli';
import { ProjectType } from '../../jobs/types';

export interface PresetPrompts {
  stableSystemPrefix: string;
  outputSchemaRules: string;
  fancyWebRubric: string;
  placeholderImageGuide: string;
}

/**
 * Get preset cached prompts for a project type
 * 
 * Returns stable, cacheable prompt segments for direct-cached pipeline.
 * All strings are byte-for-byte identical across requests.
 */
export function getPresetForProjectType(projectType: ProjectType): PresetPrompts {
  switch (projectType) {
    case 'static_html':
      return static_html;
    case 'node_project':
      return web_app_node;
    case 'discord_bot':
      return discord_bot;
    default:
      // Fallback to node_cli for unknown types
      return node_cli;
  }
}

/**
 * Check if project type should use web-specific rubrics
 */
export function isWebProject(projectType: ProjectType): boolean {
  return projectType === 'static_html' || projectType === 'node_project';
}
