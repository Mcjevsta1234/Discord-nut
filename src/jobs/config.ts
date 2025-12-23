/**
 * Job System Configuration
 * 
 * Configurable paths for job workspace, output, and logs.
 * Safe defaults with environment variable overrides.
 */

import * as path from 'path';
import * as os from 'os';

export interface JobConfig {
  workBase: string;   // Base directory for job workspaces
  outputBase: string; // Base directory for job outputs
  logBase: string;    // Base directory for job logs
}

/**
 * Get job system configuration from environment or defaults
 */
export function getJobConfig(): JobConfig {
  const tempBase = os.tmpdir();
  const botBase = path.join(tempBase, 'discord-bot-jobs');

  return {
    workBase: process.env.JOB_WORK_BASE || path.join(botBase, 'work'),
    outputBase: process.env.JOB_OUTPUT_BASE || path.join(botBase, 'output'),
    logBase: process.env.JOB_LOG_BASE || path.join(botBase, 'logs'),
  };
}
