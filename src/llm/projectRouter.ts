/**
 * Project Router - Rule-Based Project Type Detection
 * 
 * SINGLE SOURCE OF TRUTH for coding request classification.
 * 
 * Classifies requests into:
 * - static_html: Websites, landing pages, React, Next.js, frontend UI
 * - discord_bot: Discord bots with slash commands, guilds, interactions
 * - node_project: All other Node.js/backend projects
 * 
 * RULE-BASED ONLY - No LLM calls
 */

export interface ProjectRoutingDecision {
  projectType: 'static_html' | 'node_project' | 'discord_bot';
  previewAllowed: boolean;
  requiresBuild: boolean;
  description: string;
  matchedKeywords: string[];
}

export class ProjectRouter {
  /**
   * Route a coding request to the appropriate project type
   * Pure function - deterministic, no side effects, no LLM calls
   */
  static route(userMessage: string): ProjectRoutingDecision {
    const normalized = userMessage.toLowerCase();

    console.log('🎯 [PROJECT ROUTER] Analyzing request...');

    // PRIORITY 1: Discord Bot Detection
    const discordBotKeywords = [
      'discord bot',
      'discord.js',
      'slash command',
      'guild',
      'interaction',
      'bot command',
      'discord server',
      'message handler',
      'discord client',
      'discord application',
    ];

    const matchedDiscordKeywords = discordBotKeywords.filter(keyword => 
      normalized.includes(keyword)
    );

    if (matchedDiscordKeywords.length > 0) {
      console.log('🎯 [PROJECT ROUTER] → discord_bot');
      return {
        projectType: 'discord_bot',
        previewAllowed: false,
        requiresBuild: false,
        description: 'Discord bot project with interactions and commands',
        matchedKeywords: matchedDiscordKeywords,
      };
    }

    // PRIORITY 2: Static HTML/Frontend Detection
    const staticHtmlKeywords = [
      'website',
      'web site',
      'landing page',
      'frontend',
      'front-end',
      'front end',
      'ui',
      'user interface',
      'react',
      'next.js',
      'nextjs',
      'vue',
      'angular',
      'html',
      'css',
      'webpage',
      'web page',
      'site',
      'portfolio',
      'homepage',
      'dashboard',
      'admin panel',
      'web app',
      'webapp',
    ];

    const matchedStaticKeywords = staticHtmlKeywords.filter(keyword => 
      normalized.includes(keyword)
    );

    if (matchedStaticKeywords.length > 0) {
      console.log('🎯 [PROJECT ROUTER] → static_html');
      return {
        projectType: 'static_html',
        previewAllowed: true,
        requiresBuild: false,
        description: 'Static HTML/Frontend project with UI components',
        matchedKeywords: matchedStaticKeywords,
      };
    }

    // PRIORITY 3: Default to Node Project
    console.log('🎯 [PROJECT ROUTER] → node_project (default)');
    return {
      projectType: 'node_project',
      previewAllowed: true,
      requiresBuild: true,
      description: 'General Node.js backend project',
      matchedKeywords: [],
    };
  }

  /**
   * Test helper - logs routing decisions for example inputs
   */
  static test() {
    const testCases = [
      'create a website for my business',
      'build me a landing page with React',
      'make a discord bot that responds to commands',
      'write a REST API with Express',
      'code a Next.js portfolio site',
      'create a discord.js bot with slash commands',
      'build a node.js server',
      'make a frontend dashboard',
      'code a website',
    ];

    console.log('\n🧪 PROJECT ROUTER TEST SUITE\n');
    console.log('='.repeat(80));

    testCases.forEach((testCase, index) => {
      console.log(`\nTest ${index + 1}: "${testCase}"`);
      const result = ProjectRouter.route(testCase);
      console.log(`  Type: ${result.projectType}`);
      console.log(`  Preview: ${result.previewAllowed}`);
      console.log(`  Build: ${result.requiresBuild}`);
      console.log(`  Matched: ${result.matchedKeywords.join(', ') || 'none'}`);
    });

    console.log('\n' + '='.repeat(80) + '\n');
  }
}
