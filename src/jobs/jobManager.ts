/**
 * Job Manager
 * 
 * Core job lifecycle orchestration - creating jobs, managing directories,
 * tracking timing, and writing logs.
 * 
 * No LLM calls, Docker, or deployment logic here.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Job, JobInput, JobStatus, ProjectType } from './types';
import { getJobConfig } from './config';
import { ProjectRoutingDecision } from '../llm/projectRouter';

/**
 * Generate a URL-safe job ID
 */
function generateJobId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `job-${timestamp}-${random}`;
}

/**
 * Sanitize string to be URL-safe (prevent path traversal)
 */
function sanitizeForPath(str: string): string {
  return str.replace(/[^a-zA-Z0-9-_]/g, '-');
}

/**
 * Create a new job from router decision and Discord context
 */
export function createJob(
  routerDecision: ProjectRoutingDecision,
  input: JobInput
): Job {
  const config = getJobConfig();
  const jobId = generateJobId();
  
  // Default to temp directory structure
  const workspaceDir = path.join(config.workBase, jobId);
  const outputDir = path.join(config.outputBase, jobId);
  const logsPath = path.join(config.logBase, `${jobId}.log`);

  const job: Job = {
    jobId,
    createdAt: new Date().toISOString(),
    projectType: routerDecision.projectType,
    status: 'created',
    input,
    paths: {
      workspaceDir,
      outputDir,
    },
    preview: {
      enabled: routerDecision.previewAllowed,
    },
    diagnostics: {
      logsPath,
      stageTimings: {},
      tokenUsage: {
        total: 0,
        promptImprover: undefined,
        planner: undefined,
        generator: undefined,
      },
      llmMetadata: {},
      policyFlags: {
        prompterHasAppendix: false,
        plannerAppendedAppendix: false,
        codeAppendedAppendix: false,
      },
    },
  };

  return job;
}

/**
 * Update job output directory to use logs structure
 * Call this after job creation when you have Discord context (username, guild, channel)
 */
export function setJobOutputToLogsDir(
  job: Job, 
  username: string, 
  guildName: string | null, 
  channelName: string
): void {
  const logsBase = 'logs';
  const sanitized = {
    username: sanitizeForPath(username),
    guildName: guildName ? sanitizeForPath(guildName) : 'dms',
    channelName: sanitizeForPath(channelName),
  };
  
  job.paths.outputDir = path.join(
    logsBase,
    sanitized.username,
    sanitized.guildName,
    sanitized.channelName,
    'generated',
    job.jobId
  );
}

/**
 * Ensure all job directories exist
 */
export function ensureJobDirs(job: Job): void {
  const dirs = [
    job.paths.workspaceDir,
    job.paths.outputDir,
    path.dirname(job.diagnostics.logsPath),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Write a timestamped log line to job log file
 */
export function writeJobLog(job: Job, line: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${line}\n`;
  
  fs.appendFileSync(job.diagnostics.logsPath, logLine, 'utf8');
}

/**
 * Mark the start of a stage (for timing)
 */
export function markStageStart(job: Job, stageName: string): void {
  job.diagnostics.stageTimings[`${stageName}_start`] = Date.now();
  writeJobLog(job, `Stage started: ${stageName}`);
}

/**
 * Mark the end of a stage and calculate duration
 */
export function markStageEnd(job: Job, stageName: string): void {
  const endTime = Date.now();
  const startTime = job.diagnostics.stageTimings[`${stageName}_start`];
  
  if (startTime) {
    const duration = endTime - startTime;
    job.diagnostics.stageTimings[stageName] = duration;
    writeJobLog(job, `Stage completed: ${stageName} (${duration}ms)`);
  } else {
    writeJobLog(job, `Stage completed: ${stageName} (no start time recorded)`);
  }
}

/**
 * Update job status with logging
 */
export function updateJobStatus(job: Job, status: JobStatus): void {
  const oldStatus = job.status;
  job.status = status;
  writeJobLog(job, `Status changed: ${oldStatus} → ${status}`);
}

/**
 * Get job summary for logging/display
 */
export function getJobSummary(job: Job): string {
  const lines = [
    `Job ID: ${job.jobId}`,
    `Project Type: ${job.projectType}`,
    `Status: ${job.status}`,
    `Created: ${job.createdAt}`,
    `Workspace: ${job.paths.workspaceDir}`,
    `Output: ${job.paths.outputDir}`,
    `Logs: ${job.diagnostics.logsPath}`,
    `Preview Enabled: ${job.preview.enabled}`,
  ];

  // Add timing info if available
  const timings = Object.entries(job.diagnostics.stageTimings)
    .filter(([key]) => !key.endsWith('_start'))
    .map(([stage, ms]) => `  ${stage}: ${ms}ms`);
  
  if (timings.length > 0) {
    lines.push('Stage Timings:');
    lines.push(...timings);
  }

  return lines.join('\n');
}

/**
 * Safe file write with directory creation and path validation
 */
export function safeWriteFile(filePath: string, content: string): void {
  // Ensure parent directory exists
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  // Write file
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Copy file with safety checks
 */
export function safeCopyFile(source: string, dest: string): void {
  // Ensure destination directory exists
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });

  // Copy file
  fs.copyFileSync(source, dest);
}
