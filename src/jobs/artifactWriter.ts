/**
 * Artifact Writer
 * 
 * Utilities for writing placeholder artifacts and copying them to output.
 * Future stages will generate real code here via LLM.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Job, ProjectType } from './types';
import { safeWriteFile, safeCopyFile, writeJobLog } from './jobManager';

/**
 * Generate placeholder content based on project type
 */
function getPlaceholderContent(projectType: ProjectType, filename: string): string {
  const timestamp = new Date().toISOString();

  switch (projectType) {
    case 'static_html':
      if (filename === 'index.html') {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Generated Project</title>
    <style>
        body {
            font-family: system-ui, -apple-system, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            line-height: 1.6;
        }
        .badge {
            background: #f0f0f0;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.9em;
        }
    </style>
</head>
<body>
    <h1>🎨 Static HTML Project</h1>
    <p><span class="badge">Placeholder</span> Generated at ${timestamp}</p>
    <p>This is a placeholder file. Future stages will generate real code here.</p>
</body>
</html>`;
      }
      return `/* ${filename} - Generated at ${timestamp} */\n`;

    case 'node_project':
      if (filename === 'package.json') {
        return JSON.stringify({
          name: 'generated-project',
          version: '1.0.0',
          description: 'Generated Node.js project',
          main: 'src/index.js',
          scripts: {
            start: 'node src/index.js',
          },
          _placeholder: `Generated at ${timestamp}`,
        }, null, 2);
      }
      if (filename === 'src/index.js' || filename === 'src/index.ts') {
        return `// Generated at ${timestamp}
// Placeholder Node.js project

console.log('Hello from generated Node.js project!');
console.log('This is a placeholder. Future stages will generate real code.');

// TODO: Implement actual functionality
`;
      }
      return `// ${filename} - Generated at ${timestamp}\n`;

    case 'discord_bot':
      if (filename === 'bot.js') {
        return `// Discord Bot - Generated at ${timestamp}
// Placeholder Discord bot code

// This is a placeholder file.
// Future stages will generate a fully functional Discord bot.

console.log('Discord bot placeholder generated');
console.log('Add your bot token and implement commands here');

// TODO: Implement bot logic
// - Discord.js setup
// - Command handlers
// - Event listeners
`;
      }
      return `// ${filename} - Generated at ${timestamp}\n`;

    default:
      return `# Generated at ${timestamp}\n# Placeholder file\n`;
  }
}

/**
 * Write placeholder artifacts to workspace based on project type
 */
export function writePlaceholderArtifacts(job: Job): string[] {
  const files: string[] = [];

  switch (job.projectType) {
    case 'static_html':
      const htmlPath = path.join(job.paths.workspaceDir, 'index.html');
      safeWriteFile(htmlPath, getPlaceholderContent('static_html', 'index.html'));
      files.push('index.html');
      writeJobLog(job, 'Created placeholder: index.html');
      break;

    case 'node_project':
      const pkgPath = path.join(job.paths.workspaceDir, 'package.json');
      const srcDir = path.join(job.paths.workspaceDir, 'src');
      const indexPath = path.join(srcDir, 'index.js');

      safeWriteFile(pkgPath, getPlaceholderContent('node_project', 'package.json'));
      safeWriteFile(indexPath, getPlaceholderContent('node_project', 'src/index.js'));

      files.push('package.json', 'src/index.js');
      writeJobLog(job, 'Created placeholder: package.json');
      writeJobLog(job, 'Created placeholder: src/index.js');
      break;

    case 'discord_bot':
      const botPath = path.join(job.paths.workspaceDir, 'bot.js');
      safeWriteFile(botPath, getPlaceholderContent('discord_bot', 'bot.js'));
      files.push('bot.js');
      writeJobLog(job, 'Created placeholder: bot.js');
      break;
  }

  return files;
}

/**
 * Copy all files from workspace to output directory
 */
export function copyWorkspaceToOutput(job: Job): number {
  let fileCount = 0;

  function copyRecursive(src: string, dest: string) {
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        copyRecursive(srcPath, destPath);
      } else {
        safeCopyFile(srcPath, destPath);
        fileCount++;
      }
    }
  }

  copyRecursive(job.paths.workspaceDir, job.paths.outputDir);
  writeJobLog(job, `Copied ${fileCount} files from workspace to output`);

  return fileCount;
}

/**
 * List all files in output directory (for verification)
 */
export function listOutputFiles(job: Job): string[] {
  const files: string[] = [];

  function listRecursive(dir: string, base: string = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = path.join(base, entry.name);
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        listRecursive(fullPath, relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  if (fs.existsSync(job.paths.outputDir)) {
    listRecursive(job.paths.outputDir);
  }

  return files;
}
