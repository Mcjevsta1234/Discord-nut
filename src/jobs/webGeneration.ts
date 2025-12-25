/**
 * Web Generation Job Runner
 * 
 * Wraps the site generation pipeline for Discord bot integration
 */

import * as fs from 'fs';
import * as path from 'path';
import { createJob, ensureJobDirs, markStageEnd, markStageStart, setJobOutputToLogsDir, updateJobStatus, writeJobLog } from './jobManager';

export type WebMode = 'web' | 'web-pro';

export interface WebGenerationProgress {
  stage: 'prompt' | 'foundation' | 'pages' | 'assemble' | 'validate' | 'zip' | 'upload' | 'complete' | 'error';
  message: string;
  details?: string;
  currentBatch?: number;
  totalBatches?: number;
}

export interface WebGenerationResult {
  success: boolean;
  zipPath?: string;
  distDir: string;
  stats: {
    mode: string;
    theme: string;
    intentPages: number;
    generatedPages: number;
    assembledPages: number;
  };
  error?: string;
}

/**
 * Run website generation with progress callbacks
 */
export async function runWebGeneration(
  prompt: string,
  theme: string,
  mode: WebMode,
  userId: string,
  guildId: string | null,
  channelId: string,
  username: string,
  guildName: string | null,
  channelName: string,
  onProgress: (progress: WebGenerationProgress) => Promise<void>
): Promise<WebGenerationResult> {
  console.log(`🌐 [WEB] Starting generation for user ${userId}`);
  console.log(`   Prompt: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
  console.log(`   Theme: "${theme}"`);
  console.log(`   Mode: ${mode}`);
  
  try {
    // Create job for tracking
    const job = createJob(
      {
        projectType: 'static_html',
        previewAllowed: true,
        requiresBuild: false,
        description: 'Website generation via Discord bot',
        matchedKeywords: ['website', 'web'],
      },
      {
        userMessage: `${prompt} (theme: ${theme})`,
        userId,
        guildId: guildId || undefined,
        channelId,
      }
    );

    setJobOutputToLogsDir(job, username, guildName, channelName);
    ensureJobDirs(job);
    writeJobLog(job, `Web generation requested by ${userId}`);
    writeJobLog(job, `Prompt: "${prompt}"`);
    writeJobLog(job, `Theme: "${theme}"`);
    writeJobLog(job, `Mode: ${mode}`);
    
    console.log(`✓ [WEB] Job created: ${job.jobId}`);
    console.log(`   Workspace: ${job.paths.workspaceDir}`);
    console.log(`   Logs: ${job.diagnostics.logsPath}`);
console.log(`🚀 [WEB] Starting prompt analysis...`);
    
    // Use the job's workspace directory as the dist directory
    const distDir = job.paths.workspaceDir;

    await onProgress({
      stage: 'prompt',
      message: 'Analyzing and improving prompt...',
    });

    markStageStart(job, 'web_generation');

    // Run site generation via child process using tsx
    // This avoids TypeScript compilation issues with tools/ directory
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const generateSitePath = path.join(__dirname, '../../tools/generate-site.ts');
    
    // Create a temp file for the config
    const configPath = path.join(distDir, '_pipeline-config.json');
    fs.writeFileSync(configPath, JSON.stringify({ prompt, mode, theme, distDir }));
    
    console.log(`📝 [WEB] Config written to: ${configPath}`);
    
    let result: any;
    try {
      console.log(`🔧 [WEB] Executing site generation pipeline...`);
      
      // Show progress stages (site generator runs as subprocess, so we simulate stages)
      await onProgress({
        stage: 'foundation',
        message: 'Generating foundation (index, styles, components)...',
        details: `Using ${mode === 'web-pro' ? 'Gemini Pro' : 'free models'}`
      });
      
      // Run via tsx with pipeline API mode (async to avoid blocking event loop)
      const { stdout, stderr } = await execAsync(
        `npx tsx "${generateSitePath}" --api "${configPath}"`,
        {
          cwd: path.join(__dirname, '../..'),
          maxBuffer: 10 * 1024 * 1024,
        }
      );
      if (stderr && stderr.trim()) {
        console.warn('[WEB] Pipeline stderr:', stderr.trim());
      }

      console.log(`✓ [WEB] Pipeline execution completed`);
      
      await onProgress({
        stage: 'pages',
        message: 'Generating additional pages...',
        details: 'Creating game pages and content'
      });
      
      // Parse result from output - look for the LAST line that's valid JSON
      const lines = stdout.trim().split('\n');
      let jsonLine = null;
      
      // Search backwards for valid JSON
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('{') && line.includes('"success"')) {
          jsonLine = line;
          break;
        }
      }
      
      if (!jsonLine) {
        console.error(`✗ [WEB] No JSON result found in output. Last 5 lines:`);
        console.error(lines.slice(-5).join('\n'));
        throw new Error('No JSON result from site generation');
      }
      
      result = JSON.parse(jsonLine);
      console.log(`✓ [WEB] Result parsed: success=${result.success}`);
      writeJobLog(job, `Pipeline result: ${JSON.stringify(result.stats)}`);
      
      if (!result) {
        throw new Error('No result from site generation');
      }
    } catch (error) {
      console.error(`✗ [WEB] Pipeline execution failed:`, error);
      writeJobLog(job, `Pipeline error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Clean up config file on error
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
      throw error;
    }

    markStageEnd(job, 'web_generation');

    if (!result.success) {
      console.error(`✗ [WEB] Site generation returned failure`);
      throw new Error('Site generation pipeline returned failure');
    }

    console.log(`📦 [WEB] Creating zip archive...`);
    await onProgress({
      stage: 'zip',
      message: 'Creating zip archive...',
    });

    // Create zip file
    markStageStart(job, 'zip_create');
    const zipPath = await createWebZip(distDir, job.jobId);
    console.log(`✓ [WEB] Zip created: ${zipPath}`);
    writeJobLog(job, `Created ZIP: ${zipPath}`);
    markStageEnd(job, 'zip_create');

    updateJobStatus(job, 'done');
    
    console.log(`✅ [WEB] Generation complete!`);
    console.log(`   Job ID: ${job.jobId}`);
    console.log(`   Pages: ${result.stats.generatedPages}`);
    console.log(`   Zip: ${zipPath}`);

    await onProgress({
      stage: 'complete',
      message: 'Website generation complete!',
    });

    return {
      success: true,
      zipPath,
      distDir,
      stats: result.stats,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`✗ [WEB] Generation failed:`, error);
    
    await onProgress({
      stage: 'error',
      message: 'Generation failed',
      details: errorMsg,
    });

    return {
      success: false,
      distDir: '',
      stats: {
        mode: mode,
        theme: theme,
        intentPages: 0,
        generatedPages: 0,
        assembledPages: 0,
      },
      error: errorMsg,
    };
  }
}

/**
 * Create a zip archive of the generated website
 */
async function createWebZip(distDir: string, jobId: string): Promise<string> {
  const archiver = require('archiver');
  const zipPath = path.join(require('os').tmpdir(), `${jobId}.zip`);
  
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });
    
    output.on('close', () => {
      resolve(zipPath);
    });
    
    archive.on('error', (err: Error) => {
      reject(err);
    });
    
    archive.pipe(output);
    archive.directory(distDir, false);
    archive.finalize();
  });
}
