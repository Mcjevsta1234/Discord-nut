/**
 * Prompt Improver (LLM Call #1)
 * 
 * Transforms raw user requests into detailed implementation specs.
 * First stage in the LLM pipeline - outputs structured spec for planner/generator.
 */

import * as path from 'path';
import { Job, ImprovedSpec, ProjectType } from './types';
import { writeJobLog, safeWriteFile } from './jobManager';
import { OpenRouterService } from '../ai/openRouterService';

/**
 * Get the model to use for prompt improvement (configurable via env)
 */
function getPromptImproverModel(): string {
  return process.env.PROMPT_IMPROVER_MODEL || 'openai/gpt-oss-120b';
}

/**
 * Build the system prompt for the prompt improver
 */
function buildSystemPrompt(projectType: ProjectType): string {
  const commonRules = `You are a technical specification writer. Your job is to transform a user's brief request into a DETAILED, COMPREHENSIVE implementation spec.

CRITICAL OUTPUT FORMAT:
- Return EXACTLY one JSON object
- NO markdown formatting (no \`\`\`json)
- NO extra text before or after the JSON
- NO emojis or personality

Required JSON structure:
{
  "title": "short project title",
  "projectType": "${projectType}",
  "spec": "detailed multi-line specification",
  "output": {
    "format": "single_file" or "multi_file",
    "primaryFile": "filename.ext",
    "notes": "optional brief note"
  },
  "acceptanceChecklist": ["testable requirement 1", "testable requirement 2", ...]
}

VERBOSITY CONTRACT (CRITICAL):
- The "spec" field must be MINIMUM 1200-2500 words
- Must contain at least 40-80 bullet points (use "- " prefix)
- NO placeholders, NO "TODO" sections, NO vague statements
- Every requirement must be concrete and implementation-ready

REQUIRED SPEC STRUCTURE:
The "spec" field MUST contain these sections (use ## headers):

## Overview
Brief project summary and purpose

## Core Requirements
Explicit functional requirements (minimum 10 bullet points)

## UI/UX Requirements (for web/UI projects)
- Exact layout sections with content examples
- Navigation behavior and state management
- Interactive components (modals, accordions, forms, etc)
- Color schemes and typography details
- Responsive breakpoints (mobile: <768px, tablet: 768-1023px, desktop: ≥1024px)

## Data / State Model (for apps with data)
- Explicit data structures
- State management approach
- API schemas (if applicable)

## Interactions / Behaviors
- User interactions with expected outcomes
- Form validations and error messages
- Loading states and feedback mechanisms

## Accessibility
- WCAG AA compliance requirements
- Keyboard navigation support
- Screen reader considerations
- ARIA attributes needed
- Color contrast requirements (4.5:1 minimum)

## Error Handling & Edge Cases
- Expected error scenarios
- Validation rules
- Fallback behaviors
- Network failure handling

## File/Module Expectations
- Complete file structure with purpose of each file
- Module organization and responsibilities
- Configuration files needed

## Non-Goals / Prohibited Behaviors
- What NOT to do (no paid APIs unless user provided keys, no real credentials, etc)
- Constraints and limitations

## Acceptance Checklist
- Testable criteria for completion (this duplicates acceptanceChecklist field)

Use \\n for line breaks. Be extremely verbose and specific.`;

  const projectSpecificRules: Record<ProjectType, string> = {
    static_html: `
PROJECT TYPE: static_html

MANDATORY REQUIREMENTS:
- Prefer multi_file format: index.html, styles.css, script.js (if needed)
- May use CDNs and external resources (fonts, libraries, etc) UNLESS user explicitly requested offline
- ONLY use FREE APIs and services (no paid/subscription services)
- Provide CONCRETE content copy examples (headlines, body text, button labels)
- Specify exact HTML5 semantic structure (<header>, <nav>, <main>, <section>, <article>, <footer>)
- Detail every interactive component:
  * Accordions: open/close behavior, ARIA attributes
  * Modals: trigger elements, close mechanisms, focus trapping
  * Forms: all field types, validation rules, error messages
  * Navigation: mobile hamburger behavior, smooth scrolling
- Responsive design with exact breakpoints and behavior changes
- Animation rules: specify what animates and include prefers-reduced-motion support
- Mock data requirements: if backend normally needed, specify how to mock it client-side
- Progressive enhancement: works without JS where possible

ACCESSIBILITY REQUIREMENTS (mandatory):
- All interactive elements keyboard accessible
- Focus indicators visible
- Color contrast WCAG AA (4.5:1 for text)
- Alt text for all images
- ARIA labels for icon-only buttons
- Form labels properly associated
- Skip navigation link

FILE STRUCTURE EXAMPLE:
- index.html: semantic HTML structure
- styles.css: organized by component/section
- script.js: vanilla JS for interactions (if needed)
- README.md: setup instructions

ACCEPTANCE CHECKLIST (15-40 items):
Include items like:
- "Header contains logo and navigation with 4+ links"
- "Hero section has headline, subtitle, and CTA button"
- "All images have descriptive alt text"
- "Navigation collapses to hamburger menu on mobile (<768px)"
- "Form validates email format and shows inline error messages"
- "Page is fully functional without JavaScript for core content"
- "All interactive elements have :focus styles"
- "prefers-reduced-motion disables animations"`,

    node_project: `
PROJECT TYPE: node_project

MANDATORY REQUIREMENTS:
- Always multi_file format with proper structure
- Framework: Express.js + Zod validation (unless user specified otherwise)
- Language: JavaScript (unless TypeScript explicitly requested)
- May use any NPM packages and external APIs UNLESS user explicitly restricted
- ONLY use FREE APIs and services (no paid/subscription services unless user provided API keys)
- If TypeScript: strict tsconfig with noImplicitAny, strictNullChecks

FILE STRUCTURE (required detail):
- package.json: all dependencies, scripts (start, dev, test)
- src/index.js: server entry point
- src/routes/: one file per resource
- src/controllers/: business logic
- src/middleware/: auth, validation, error handling
- src/models/: data models (if database)
- src/config/: configuration loading
- .env.example: all environment variables with descriptions
- README.md: setup, run, test instructions

API SPECIFICATION (mandatory):
For each endpoint, provide:
- HTTP method and path
- Request schema (headers, params, query, body)
- Response schema (success and error cases)
- Example requests and responses

EXAMPLE:
- POST /api/users
  - Body: { email: string, name: string }
  - Response 201: { id: string, email: string, name: string }
  - Response 400: { error: string, details: [...] }

ERROR HANDLING (required):
- Standard JSON error format: { error: string, details?: any }
- Centralized error middleware
- Validation errors return 400
- Not found returns 404
- Server errors return 500 with safe messages

SECURITY REQUIREMENTS:
- Input validation using Zod schemas
- Rate limiting note (express-rate-limit suggested)
- Environment variable validation on startup
- No sensitive data in logs
- Helmet.js for security headers

LOGGING:
- Structured logging approach (JSON logs)
- Request/response logging middleware
- Error logging with stack traces in development

SCRIPTS (package.json):
- "start": production server
- "dev": development with auto-reload
- "test": run test suite (if tests included)
- "lint": code linting

ACCEPTANCE CHECKLIST (20-40 items):
- "Server starts on configurable PORT from .env"
- "All routes return JSON responses"
- "Invalid request bodies return 400 with Zod error details"
- "Rate limiting prevents abuse"
- "Error middleware catches all unhandled errors"
- "README includes curl examples for all endpoints"`,

    discord_bot: `
PROJECT TYPE: discord_bot

MANDATORY REQUIREMENTS:
- discord.js v14
- Prefer multi_file: commands/, events/, config/
- Use single_file ONLY if extremely simple (1-2 basic commands)

FILE STRUCTURE (required):
- src/index.js: bot entry, client setup, event/command loading
- src/config/config.js: intents, token loading, validation
- src/commands/: one file per command (exports data + execute)
- src/events/: one file per event handler
- src/utils/: helper functions (command registration, etc)
- .env.example: DISCORD_TOKEN, CLIENT_ID, GUILD_ID (with comments)
- deploy-commands.js: script to register slash commands
- README.md: setup steps, invite link generation, troubleshooting

GATEWAY INTENTS (specify exactly):
List all required intents:
- GatewayIntentBits.Guilds (always required)
- GatewayIntentBits.GuildMessages (if reading messages)
- GatewayIntentBits.MessageContent (if reading message content - privileged)
- etc.

COMMAND SPECIFICATION (mandatory detail):
For each command, provide:
- Name and description
- Options (name, type, description, required)
- Permission requirements
- Expected behavior with examples
- Error cases

EXAMPLE:
- /ping
  - Description: "Replies with bot latency"
  - Options: none
  - Response: "Pong! Latency: 42ms"

EVENTS (required):
- ready: log successful login, set presence
- interactionCreate: route slash commands
- error: log errors

PERMISSIONS:
- Specify bot permissions needed (VIEW_CHANNEL, SEND_MESSAGES, etc)
- Mention any privileged intents and how to enable

RATE LIMIT HANDLING:
- Note that commands should handle rate limits gracefully
- Defer long-running interactions

ENVIRONMENT VARIABLES (.env.example):
- DISCORD_TOKEN=your_bot_token_here  # Get from Discord Developer Portal
- CLIENT_ID=your_application_id      # Application ID from portal
- GUILD_ID=optional_guild_id         # For testing guild-specific commands

README REQUIREMENTS:
- Prerequisites (Node.js version)
- Setup steps (install deps, create .env, register commands)
- How to generate bot invite link
- How to enable intents in Developer Portal
- Troubleshooting common issues

ACCEPTANCE CHECKLIST (15-40 items):
- "Bot uses discord.js v14"
- "Commands are slash commands (interactions)"
- "deploy-commands.js successfully registers all commands"
- "Bot logs successful login on ready event"
- ".env.example lists all required variables with descriptions"
- "README includes invite link generation instructions"
- "Commands handle errors and defer long operations"
- "No real tokens in code or committed files"`,
  };

  return commonRules + '\n\n' + projectSpecificRules[projectType];
}

/**
 * Validate the improved spec JSON structure
 */
function validateSpec(data: any, job?: Job): data is ImprovedSpec {
  const log = (msg: string) => {
    if (job) writeJobLog(job, msg);
  };
  
  if (!data || typeof data !== 'object') {
    log('Validation failed: data is not an object');
    return false;
  }
  if (typeof data.title !== 'string' || !data.title) {
    log('Validation failed: title is missing or not a string');
    return false;
  }
  if (!['static_html', 'node_project', 'discord_bot'].includes(data.projectType)) {
    log(`Validation failed: projectType '${data.projectType}' is invalid`);
    return false;
  }
  if (typeof data.spec !== 'string' || !data.spec) {
    log('Validation failed: spec is missing or not a string');
    return false;
  }
  if (!data.output || typeof data.output !== 'object') {
    log('Validation failed: output is missing or not an object');
    return false;
  }
  if (!['single_file', 'multi_file'].includes(data.output.format)) {
    log(`Validation failed: output.format '${data.output?.format}' is invalid`);
    return false;
  }
  if (typeof data.output.primaryFile !== 'string' || !data.output.primaryFile) {
    log('Validation failed: output.primaryFile is missing or not a string');
    return false;
  }
  if (!Array.isArray(data.acceptanceChecklist)) {
    log('Validation failed: acceptanceChecklist is not an array');
    return false;
  }
  if (data.acceptanceChecklist.length < 15 || data.acceptanceChecklist.length > 40) {
    log(`Validation failed: acceptanceChecklist has ${data.acceptanceChecklist.length} items (need 15-40)`);
    return false;
  }
  if (!data.acceptanceChecklist.every((item: any) => typeof item === 'string' && item.length > 0)) {
    log('Validation failed: acceptanceChecklist contains non-string or empty items');
    return false;
  }
  
  return true;
}

/**
 * Parse LLM response and extract JSON
 */
function parseImproverResponse(response: string, job?: Job): ImprovedSpec | null {
  try {
    // Try direct JSON parse first
    const parsed = JSON.parse(response);
    if (validateSpec(parsed, job)) {
      return parsed as ImprovedSpec;
    }
    return null;
  } catch {
    // If direct parse fails, try to extract JSON from markdown
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (validateSpec(parsed, job)) {
          return parsed as ImprovedSpec;
        }
      } catch {
        return null;
      }
    }
    
    // Try to find JSON object anywhere in the response
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        if (validateSpec(parsed, job)) {
          return parsed as ImprovedSpec;
        }
      } catch {
        return null;
      }
    }
    
    return null;
  }
}

/**
 * Audit spec verbosity and structure
 */
interface SpecMetrics {
  wordCount: number;
  bulletCount: number;
  sectionsFound: string[];
}

function auditSpecVerbosity(spec: ImprovedSpec): SpecMetrics {
  const specText = spec.spec;
  
  // Count words (split on whitespace)
  const words = specText.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  
  // Count bullet points (lines starting with "- ")
  const lines = specText.split('\n');
  const bulletCount = lines.filter(line => line.trim().startsWith('- ')).length;
  
  // Find section headers (lines starting with ##)
  const sectionsFound = lines
    .filter(line => line.trim().startsWith('##'))
    .map(line => line.trim().replace(/^##\s*/, ''));
  
  return { wordCount, bulletCount, sectionsFound };
}

/**
 * Check if spec meets verbosity requirements
 */
function meetsVerbosityRequirements(metrics: SpecMetrics): boolean {
  return metrics.wordCount >= 1200 && metrics.bulletCount >= 40;
}

/**
 * Run the prompt improver stage
 */
export async function runPromptImprover(
  job: Job,
  aiService: OpenRouterService
): Promise<void> {
  const model = getPromptImproverModel();
  
  writeJobLog(job, `Starting prompt improver with model: ${model}`);
  writeJobLog(job, `User message: "${job.input.userMessage}"`);
  writeJobLog(job, `Project type: ${job.projectType}`);
  
  const systemPrompt = buildSystemPrompt(job.projectType);
  const userPrompt = `User request: ${job.input.userMessage}\n\nGenerate the detailed specification JSON now.`;
  
  let attempt = 0;
  let rawResponse: string | null = null;
  let spec: ImprovedSpec | null = null;
  let tokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    model,
    cost: 0,
  };
  
  // Attempt 1: Initial call
  try {
    attempt = 1;
    writeJobLog(job, `Attempt ${attempt}: Calling LLM for spec generation`);
    
    const result = await aiService.chatCompletionWithMetadata(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model
    );
    
    rawResponse = result.content;
    
    // Track token usage from metadata
    if (result.metadata.usage) {
      tokenUsage.promptTokens = result.metadata.usage.promptTokens || 0;
      tokenUsage.completionTokens = result.metadata.usage.completionTokens || 0;
      tokenUsage.totalTokens = result.metadata.usage.totalTokens || 0;
      tokenUsage.cost = result.metadata.estimatedCost || 0;
    }
    
    writeJobLog(job, `Received response (${rawResponse.length} chars, ${tokenUsage.totalTokens} tokens, $${tokenUsage.cost.toFixed(4)})`);
    
    spec = parseImproverResponse(rawResponse, job);
    
    spec = parseImproverResponse(rawResponse);
    
    if (spec) {
      writeJobLog(job, `✓ Successfully parsed spec on attempt ${attempt}`);
      
      // Audit verbosity
      const metrics = auditSpecVerbosity(spec);
      writeJobLog(job, `Spec metrics: ${metrics.wordCount} words, ${metrics.bulletCount} bullets, ${metrics.sectionsFound.length} sections`);
      writeJobLog(job, `Sections found: ${metrics.sectionsFound.join(', ')}`);
      
      if (!meetsVerbosityRequirements(metrics)) {
        writeJobLog(job, `⚠ Spec below verbosity target (need 1200+ words, 40+ bullets)`);
        // Don't accept this spec yet, will retry
        spec = null;
      }
    }
  } catch (error) {
    writeJobLog(job, `✗ Attempt ${attempt} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  // Attempt 2: Retry with fix instructions (for invalid JSON) OR verbosity expansion
  if (!spec && attempt === 1) {
    try {
      attempt = 2;
      
      // Determine if we need JSON fix or verbosity expansion
      const parsedWithoutVerbosityCheck = rawResponse ? parseImproverResponse(rawResponse) : null;
      const needsVerbosity = parsedWithoutVerbosityCheck !== null;
      
      if (needsVerbosity) {
        writeJobLog(job, `Attempt ${attempt}: Requesting verbosity expansion`);
        
        const verbosityPrompt = `Your previous spec was too short. It MUST be expanded to meet these requirements:
- MINIMUM 1200 words in the "spec" field
- MINIMUM 40 bullet points (lines starting with "- ")
- Include ALL required sections: Overview, Core Requirements, UI/UX Requirements, Data/State Model, Interactions/Behaviors, Accessibility, Error Handling & Edge Cases, File/Module Expectations, Non-Goals, Acceptance Checklist
- Be extremely verbose and specific
- NO placeholders or TODO items

Expand the spec to meet these requirements. Return ONLY the complete JSON object with the expanded spec.`;
        
        const result = await aiService.chatCompletion(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: verbosityPrompt },
          ],
          model
        );
        
        rawResponse = result;
        writeJobLog(job, `Received expanded response (${rawResponse.length} chars)`);
      } else {
        writeJobLog(job, `Attempt ${attempt}: Retrying with JSON fix instructions`);
        
        const fixPrompt = `Your previous response was not valid JSON. Please return ONLY a valid JSON object with no markdown formatting, no code blocks, no extra text. Just the raw JSON object starting with { and ending with }.

Required structure:
{
  "title": "string",
  "projectType": "${job.projectType}",
  "spec": "string (1200+ words, 40+ bullets)",
  "output": {
    "format": "single_file" or "multi_file",
    "primaryFile": "string",
    "notes": "optional string"
  },
  "acceptanceChecklist": ["item1", "item2", ... 15-40 items]
}

Return the JSON now:`;
        
        const result = await aiService.chatCompletionWithMetadata(
          [
            { role: 'system', content: 'Return only valid JSON. No markdown. No extra text. Minimum 1200 words in spec field.' },
            { role: 'user', content: fixPrompt },
          ],
          model
        );
        
        rawResponse = result.content;
        
        // Add token usage from retry
        if (result.metadata.usage) {
          tokenUsage.promptTokens += result.metadata.usage.promptTokens || 0;
          tokenUsage.completionTokens += result.metadata.usage.completionTokens || 0;
          tokenUsage.totalTokens += result.metadata.usage.totalTokens || 0;
          tokenUsage.cost += result.metadata.estimatedCost || 0;
        }
        
        writeJobLog(job, `Received retry response (${rawResponse.length} chars, cumulative: ${tokenUsage.totalTokens} tokens, $${tokenUsage.cost.toFixed(4)})`);
      }
      
      spec = parseImproverResponse(rawResponse, job);
      
      if (spec) {
        writeJobLog(job, `✓ Successfully parsed spec on attempt ${attempt}`);
        
        // Audit verbosity again
        const metrics = auditSpecVerbosity(spec);
        writeJobLog(job, `Spec metrics: ${metrics.wordCount} words, ${metrics.bulletCount} bullets, ${metrics.sectionsFound.length} sections`);
        
        if (!meetsVerbosityRequirements(metrics)) {
          writeJobLog(job, `⚠ WARNING: Spec still below verbosity target after ${attempt} attempts`);
          // Continue anyway but log warning
        }
      }
    } catch (error) {
      writeJobLog(job, `✗ Attempt ${attempt} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // Final validation
  if (!spec) {
    writeJobLog(job, `✗ Failed to generate valid spec after ${attempt} attempts`);
    writeJobLog(job, `Raw response: ${rawResponse?.substring(0, 500) || 'null'}`);
    throw new Error('Failed to generate valid specification');
  }
  
  // Final metrics audit
  const finalMetrics = auditSpecVerbosity(spec);
  writeJobLog(job, `Final spec metrics: ${finalMetrics.wordCount} words, ${finalMetrics.bulletCount} bullets`);
  writeJobLog(job, `Sections: ${finalMetrics.sectionsFound.join(', ')}`);
  writeJobLog(job, `Acceptance checklist items: ${spec.acceptanceChecklist.length}`);
  
  // Store metrics in diagnostics
  job.diagnostics.specMetrics = finalMetrics;
  
  // Log to console
  console.log(`📊 Spec Metrics:`);
  console.log(`   Words: ${finalMetrics.wordCount}`);
  console.log(`   Bullets: ${finalMetrics.bulletCount}`);
  console.log(`   Sections: ${finalMetrics.sectionsFound.length}`);
  console.log(`   Checklist: ${spec.acceptanceChecklist.length} items`);
  
  // Store token usage
  job.diagnostics.tokenUsage.promptImprover = tokenUsage;
  
  // Save spec to job
  job.spec = spec;
  
  // Save spec.json
  const specJsonPath = path.join(job.paths.workspaceDir, 'spec.json');
  safeWriteFile(specJsonPath, JSON.stringify(spec, null, 2));
  writeJobLog(job, `Saved spec.json: ${specJsonPath}`);
  
  // Save spec.txt (human-friendly)
  const specTxtPath = path.join(job.paths.workspaceDir, 'spec.txt');
  const specText = `Title: ${spec.title}
Project Type: ${spec.projectType}
Output Format: ${spec.output.format}
Primary File: ${spec.output.primaryFile}
${spec.output.notes ? `Notes: ${spec.output.notes}\n` : ''}
Specification:
${spec.spec}

Acceptance Checklist:
${spec.acceptanceChecklist.map((item, i) => `${i + 1}. ${item}`).join('\n')}`;
  
  safeWriteFile(specTxtPath, specText);
  writeJobLog(job, `Saved spec.txt: ${specTxtPath}`);
  
  writeJobLog(job, `Spec generation complete - Title: "${spec.title}"`);
  writeJobLog(job, `Primary file: ${spec.output.primaryFile} (${spec.output.format})`);
}

