# Job Lifecycle System

## Overview
The Job Lifecycle System provides infrastructure for managing end-to-end coding request processing with proper artifact management, logging, and stage tracking. This is the foundation for future LLM-based code generation, Docker packaging, and deployment.

## Architecture

### Core Components

1. **Job Model** (`src/jobs/types.ts`)
   - Complete job state representation
   - Status tracking through lifecycle stages
   - Path management for workspace/output/logs
   - Diagnostics with timing and token usage

2. **Job Manager** (`src/jobs/jobManager.ts`)
   - Job creation and directory setup
   - Stage timing tracking
   - Logging with timestamps
   - Status updates

3. **Artifact Writer** (`src/jobs/artifactWriter.ts`)
   - Placeholder generation (current)
   - Future: LLM-generated code
   - Workspace → Output copying
   - File listing utilities

4. **Configuration** (`src/jobs/config.ts`)
   - Configurable base directories
   - Environment variable overrides
   - Safe defaults using OS temp

## Job Lifecycle

```
created → planned → generated → validated → packaged → deployed → done
                                                                ↓
                                                             failed
```

Current implementation: `created → generated → done`

Future stages will fill in: `planned`, `validated`, `packaged`, `deployed`

## Directory Structure

Base directories (configurable via env):
```
WORK_BASE=/tmp/discord-bot-jobs/work      # JOB_WORK_BASE
OUTPUT_BASE=/tmp/discord-bot-jobs/output  # JOB_OUTPUT_BASE
LOG_BASE=/tmp/discord-bot-jobs/logs       # JOB_LOG_BASE
```

Per-job structure:
```
work/
  job-abc123/           # workspaceDir - temp files, generation
    index.html
    package.json
    src/
      index.js

output/
  job-abc123/           # outputDir - ready for packaging
    index.html
    package.json
    src/
      index.js

logs/
  job-abc123.log        # logsPath - timestamped activity log
```

## Usage

### Create and Process Job

```typescript
import { ProjectRouter } from './ai/projectRouter';
import {
  createJob,
  ensureJobDirs,
  writeJobLog,
  markStageStart,
  markStageEnd,
  updateJobStatus,
  writePlaceholderArtifacts,
  copyWorkspaceToOutput,
} from './jobs';

// 1. Get routing decision
const routerDecision = ProjectRouter.route(userMessage);

// 2. Create job
const job = createJob(routerDecision, {
  userMessage,
  userId,
  guildId,
  channelId,
});

// 3. Setup directories
ensureJobDirs(job);

// 4. Log activity
writeJobLog(job, `Processing request: "${userMessage}"`);

// 5. Execute stages with timing
markStageStart(job, 'artifact_generation');
const files = writePlaceholderArtifacts(job);
updateJobStatus(job, 'generated');
markStageEnd(job, 'artifact_generation');

// 6. Copy to output
markStageStart(job, 'output_copy');
copyWorkspaceToOutput(job);
markStageEnd(job, 'output_copy');

// 7. Complete
updateJobStatus(job, 'done');
```

### Job Fields

```typescript
interface Job {
  jobId: string;                    // "job-mjipke1e-19z50e"
  createdAt: string;                // "2025-12-23T14:56:47.378Z"
  projectType: ProjectType;         // "static_html" | "node_project" | "discord_bot"
  status: JobStatus;                // "created" | ... | "done" | "failed"
  
  input: {
    userMessage: string;
    userId: string;
    guildId?: string;
    channelId: string;
  };
  
  paths: {
    workspaceDir: string;           // Temp generation workspace
    outputDir: string;              // Final artifacts
    zipPath?: string;               // Future: packaged artifact
    deployDir?: string;             // Future: deployment location
  };
  
  preview: {
    enabled: boolean;               // From router decision
    url?: string;                   // Future: preview URL
    expiresAt?: number;             // Future: expiration time
  };
  
  diagnostics: {
    logsPath: string;               // Log file path
    stageTimings: Record<string, number>;  // { "artifact_generation": 15 }
    tokenUsage: { total: number };  // Future: LLM token tracking
  };
}
```

## Testing

### CLI Test Script

```bash
# Run test suite
npm run build
node scripts/test-job.js
```

Output:
```
=== Job System Test Suite ===

Test 1: "create a landing page for my startup"
  ✓ Router decision: static_html
  ✓ Job created: job-mjipke1e-19z50e
  ✓ Directories created
  ✓ Placeholder files generated: index.html
  ✓ Files copied to output
  ✓ Job completed

Test 2: "build a discord bot with slash commands"
  ✓ Router decision: discord_bot
  ✓ Job created: job-mjipke1n-p7my6n
  ✓ Files generated: bot.js

Test 3: "make an Express API server"
  ✓ Router decision: node_project
  ✓ Files generated: package.json, src/index.js
```

### Integration Test

The job system is integrated into the Discord bot message handler. When a coding request is made:

1. Router classifies project type
2. Job is created with unique ID
3. Directories and logs are initialized
4. Placeholder artifacts are generated (temporary)
5. Files are copied to output directory
6. Job status is tracked through lifecycle

## Placeholder Content

Current placeholder generation by project type:

**static_html:**
- `index.html` - Full HTML5 boilerplate with basic styling

**node_project:**
- `package.json` - Valid Node.js package manifest
- `src/index.js` - Basic console.log starter

**discord_bot:**
- `bot.js` - Discord bot template with TODO comments

## Safety Features

- **URL-safe Job IDs**: Sanitized using base36 encoding
- **Path traversal prevention**: No user-provided filenames yet
- **Recursive directory creation**: Safe mkdir with parents
- **Append-only logs**: Timestamped, non-blocking writes
- **Error isolation**: Job failures don't crash the bot

## Future Integration Points

### Stage 3: LLM Planning (TODO)
Replace `writePlaceholderArtifacts()` with:
```typescript
markStageStart(job, 'planning');
const plan = await llmPlanner.generatePlan(job);
updateJobStatus(job, 'planned');
markStageEnd(job, 'planning');
```

### Stage 4: Code Generation (TODO)
```typescript
markStageStart(job, 'generation');
await llmGenerator.generateFiles(job, plan);
updateJobStatus(job, 'generated');
markStageEnd(job, 'generation');
```

### Stage 5: Validation (TODO)
```typescript
markStageStart(job, 'validation');
const valid = await validator.check(job);
updateJobStatus(job, 'validated');
markStageEnd(job, 'validation');
```

### Stage 6: Docker Packaging (TODO)
```typescript
markStageStart(job, 'packaging');
job.paths.zipPath = await dockerPackager.package(job);
updateJobStatus(job, 'packaged');
markStageEnd(job, 'packaging');
```

### Stage 7: Deployment (TODO)
```typescript
markStageStart(job, 'deployment');
job.preview.url = await deployer.deploy(job);
job.preview.expiresAt = Date.now() + 3600000; // 1 hour
updateJobStatus(job, 'deployed');
markStageEnd(job, 'deployment');
```

## Environment Configuration

```bash
# Optional: Override default paths
export JOB_WORK_BASE=/var/bot/work
export JOB_OUTPUT_BASE=/var/bot/output
export JOB_LOG_BASE=/var/bot/logs
```

Defaults (if not set):
- Work: `/tmp/discord-bot-jobs/work`
- Output: `/tmp/discord-bot-jobs/output`
- Logs: `/tmp/discord-bot-jobs/logs`

## Log Format

Each log entry is timestamped:
```
[2025-12-23T14:56:47.380Z] Job created for message: "create a landing page"
[2025-12-23T14:56:47.381Z] Project type: static_html
[2025-12-23T14:56:47.381Z] Stage started: artifact_generation
[2025-12-23T14:56:47.382Z] Created placeholder: index.html
[2025-12-23T14:56:47.382Z] Stage completed: artifact_generation (1ms)
[2025-12-23T14:56:47.382Z] Status changed: created → generated
```

## Status

✅ **Implemented:**
- Job model and lifecycle tracking
- Directory management
- Placeholder artifact generation
- Workspace → Output copying
- Timestamped logging
- Stage timing
- CLI test script
- Discord bot integration

⏳ **Not Yet Implemented (Future Prompts):**
- LLM-based code generation
- File validation
- Docker packaging
- Preview deployment
- Token usage tracking
- Database persistence
- Job cleanup/expiration
