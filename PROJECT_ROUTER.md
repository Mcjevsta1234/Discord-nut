# Project Router Implementation

## Overview
Implemented a centralized, rule-based project router that classifies coding requests into project types without using LLM calls. This is Phase 1 of a multi-stage architecture.

## Changes Made

### 1. Created ProjectRouter Module (`src/ai/projectRouter.ts`)
- **Purpose**: Single source of truth for project type detection
- **Method**: Rule-based keyword matching (deterministic, no LLM)
- **Output Interface**:
  ```typescript
  interface ProjectRoutingDecision {
    projectType: 'static_html' | 'node_project' | 'discord_bot';
    previewAllowed: boolean;
    requiresBuild: boolean;
    description: string;
    matchedKeywords: string[];
  }
  ```

### 2. Project Classification Logic
**Priority 1: Discord Bot**
- Keywords: discord bot, discord.js, slash command, guild, interaction, message handler
- Config: `previewAllowed=false, requiresBuild=false`

**Priority 2: Static HTML/Frontend**
- Keywords: website, landing page, frontend, react, next.js, vue, html, css, ui, dashboard, portfolio, site
- Config: `previewAllowed=true, requiresBuild=false`

**Priority 3: Node Project (Default)**
- Fallback for all other coding requests (APIs, CLIs, servers)
- Config: `previewAllowed=true, requiresBuild=true`

### 3. MessageHandler Integration (`src/discord/messageHandler.ts`)
- Added ProjectRouter import
- Removed ImageService completely (import, field, initialization, usage)
- Modified CODING tier to call `ProjectRouter.route()`
- Logs routing decision with 📦 prefix
- Added TODO comments for future stages:
  - Stage 2: Prompt Improver
  - Stage 3: Project Planner
  - Stage 4: Code Generator
  - Stage 5: Deployer (Docker + preview)

### 4. Removed Image Generation
- Deleted 2 deprecated image methods (~200 lines)
- Removed image button from responses
- Replaced image button handler with deprecation message
- Removed all ImageService references from MessageHandler
- Note: ImageService still exists in ActionExecutor but is no longer called

### 5. Test Suite
- Built-in test method: `ProjectRouter.test()`
- External test script: `test-router.js`
- All tests passing ✅

## Architecture Vision

### Current State (Phase 1)
```
User Message → MessageHandler → ProjectRouter → [Route Decision]
                                                       ↓
                                              (Temporarily uses existing CodeImprover)
```

### Future State (Phase 2-5)
```
User Message → ProjectRouter → Prompt Improver → Project Planner → Code Generator → Deployer
                   ↓                ↓                  ↓                 ↓              ↓
               [Route]       [Enhanced Prompt]    [File Plan]      [Generated]   [Preview URL]
```

## Usage

### From Code
```typescript
import { ProjectRouter } from './ai/projectRouter';

const decision = ProjectRouter.route("create a landing page");
// {
//   projectType: 'static_html',
//   previewAllowed: true,
//   requiresBuild: false,
//   description: 'Static HTML/Frontend project with UI components',
//   matchedKeywords: ['landing page']
// }
```

### Testing
```bash
# Compile
npm run build

# Run tests
node test-router.js
```

## Logging
Router decisions are logged with 📦 prefix:
```
📦 Project Type: static_html
📦 Preview Allowed: true
📦 Requires Build: false
📦 Matched Keywords: landing page, ui
```

## Next Steps (Future PRs)
1. **Stage 2**: Prompt Improver - Enhance user request into detailed coding prompt
2. **Stage 3**: Project Planner - Create file structure, dependencies, config
3. **Stage 4**: Code Generator - Generate actual code files with LLM
4. **Stage 5**: Deployer - Docker containerization + preview URLs for eligible projects

## Testing Results
- ✅ TypeScript compilation successful
- ✅ Discord bot detection working
- ✅ Static HTML detection working  
- ✅ Node project fallback working
- ✅ No ImageService references remaining
- ✅ All test cases passing
