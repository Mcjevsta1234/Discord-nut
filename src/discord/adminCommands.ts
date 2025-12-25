import {
  ChatInputCommandInteraction,
  Client,
  Interaction,
  AttachmentBuilder,
  PermissionFlagsBits,
  RESTPostAPIApplicationCommandsJSONBody,
  SlashCommandBuilder,
  Message,
} from 'discord.js';
import { config } from '../config';
import { PromptManager } from './promptManager';
import { AdminConfigManager } from './adminConfig';
import { ContextService } from '../memory/contextService';
import { getAllPersonaIds, getPersona } from '../personas.config';
import { ResponseRenderer, ResponseMetadata, ProgressTracker } from './responseRenderer';
import { setDebugMode, parseDebugMode, getDebugMode, getDebugModeDescription } from './debugMode';
import { ImageService } from '../llm/imageService';
import { env } from '../config/env';
import { OpenRouterService } from '../llm/openRouterService';
import { ProjectRouter } from '../llm/projectRouter';
import { createJob, ensureJobDirs, markStageEnd, markStageStart, setJobOutputToLogsDir, updateJobStatus, writeJobLog } from '../jobs/jobManager';
import { copyWorkspaceToOutput, createZipArchive } from '../jobs/artifactWriter';
import { runDirectCachedCodegen } from '../jobs/codegen';
import { runDirectCodegen } from '../jobs/directCodegen';
import { modelSupportsCaching } from '../llm/modelCaps';
import { webQueue } from '../jobs/webQueue';
import { runWebGeneration, WebGenerationProgress } from '../jobs/webGeneration';
import fs from 'fs';
import { EmbedBuilder } from 'discord.js';
import { calculateCost, TokenUsage } from '../llm/llmMetadata';

type PromptAction = 'replace' | 'append' | 'clear';

export class AdminCommandHandler {
  private client: Client;
  private promptManager: PromptManager;
  private contextService: ContextService;
  private adminConfig: AdminConfigManager;
  private imageService: ImageService;
  private aiService: OpenRouterService;

  constructor(client: Client, promptManager: PromptManager, aiService: OpenRouterService) {
    this.client = client;
    this.promptManager = promptManager;
    this.contextService = new ContextService();
    this.adminConfig = new AdminConfigManager();
    this.imageService = new ImageService();
    this.aiService = aiService;
  }

  async registerCommands(): Promise<void> {
    const personaIds = getAllPersonaIds();
    const personaChoices = personaIds.map((id) => {
      const persona = getPersona(id);
      return {
        name: persona?.displayName || id,
        value: id,
      };
    });

    const commands: RESTPostAPIApplicationCommandsJSONBody[] = [
      new SlashCommandBuilder()
        .setName('set-persona')
        .setDescription('Set the bot persona for this channel')
        .addStringOption((option) => {
          let opt = option
            .setName('persona')
            .setDescription('Choose a persona')
            .setRequired(true);
          
          personaChoices.forEach((choice) => {
            opt = opt.addChoices(choice);
          });
          
          return opt;
        })
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .toJSON(),
      // Admin config: set role
      new SlashCommandBuilder()
        .setName('admin-set-role')
        .setDescription('Set the server admin role (members with this role can run admin commands)')
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('Select the role to grant admin privileges')
            .setRequired(true)
        )
        .toJSON(),
      // Admin config: set permission requirement
      new SlashCommandBuilder()
        .setName('admin-set-permission')
        .setDescription('Set the server admin permission requirement (e.g., MANAGE_GUILD)')
        .addStringOption((option) =>
          option
            .setName('permission')
            .setDescription('Discord permission name (e.g., MANAGE_GUILD, ADMINISTRATOR)')
            .setRequired(true)
            .addChoices(
              { name: 'MANAGE_GUILD', value: 'ManageGuild' },
              { name: 'ADMINISTRATOR', value: 'Administrator' },
              { name: 'MANAGE_CHANNELS', value: 'ManageChannels' },
              { name: 'MANAGE_ROLES', value: 'ManageRoles' }
            )
        )
        .toJSON(),
      // Admin config: clear
      new SlashCommandBuilder()
        .setName('admin-clear-config')
        .setDescription('Clear custom admin config for this server (reverts to MANAGE_GUILD)')
        .toJSON(),
      // Clear context command with subcommands
      new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear conversation context')
        .addSubcommand((sc) =>
          sc
            .setName('me')
            .setDescription('Clear YOUR stored conversation context for this channel or DM')
        )
        .addSubcommand((sc) =>
          sc
            .setName('channel')
            .setDescription('Admin only: Clear ALL user contexts for this channel')
        )
        .addSubcommand((sc) =>
          sc
            .setName('server')
            .setDescription('Admin only: Clear ALL contexts for this server')
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('set-chat-model')
        .setDescription('Set the chat model for this channel')
        .addStringOption((option) =>
          option
            .setName('model')
            .setDescription('Model name')
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .toJSON(),
      new SlashCommandBuilder()
        .setName('debug')
        .setDescription('Set debug information level for bot responses')
        .addStringOption((option) =>
          option
            .setName('mode')
            .setDescription('Debug mode level')
            .setRequired(true)
            .addChoices(
              { name: 'Full - All information (routing, tokens, pricing, timing)', value: 'full' },
              { name: 'Simple - Plan, Tools, Performance only', value: 'simple' },
              { name: 'Off - No system embed, chat only', value: 'off' }
            )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .toJSON(),
      new SlashCommandBuilder()
        .setName('clear-context')
        .setDescription('Clear YOUR stored conversation context for this channel or DM (no other users affected)')
        .toJSON(),
      new SlashCommandBuilder()
        .setName('premium-role')
        .setDescription('Manage the premium role for this server')
        .addSubcommand((sc) =>
          sc
            .setName('set')
            .setDescription('Set the premium role required for premium commands')
            .addRoleOption((opt) =>
              opt
                .setName('role')
                .setDescription('Role that grants premium access')
                .setRequired(true)
            )
        )
        .addSubcommand((sc) =>
          sc
            .setName('show')
            .setDescription('Show the current premium role')
        )
        .addSubcommand((sc) =>
          sc
            .setName('clear')
            .setDescription('Clear the premium role requirement')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .toJSON(),
      new SlashCommandBuilder()
        .setName('imagine')
        .setDescription('Generate an image (premium only)')
        .addStringOption((opt) =>
          opt
            .setName('prompt')
            .setDescription('Describe the image to generate')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('size')
            .setDescription('Image size')
            .setRequired(false)
            .addChoices(
              { name: 'Square (1024x1024)', value: '1024x1024' },
              { name: 'Portrait (1024x1792)', value: '1024x1792' },
              { name: 'Landscape (1792x1024)', value: '1792x1024' }
            )
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('flash')
        .setDescription('Generate code with fast model (premium only)')
        .addStringOption((opt) =>
          opt
            .setName('prompt')
            .setDescription('What should I build?')
            .setRequired(true)
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('pro')
        .setDescription('Generate code with pro model (premium only)')
        .addStringOption((opt) =>
          opt
            .setName('prompt')
            .setDescription('What should I build?')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('model')
            .setDescription('Choose pro model')
            .setRequired(false)
            .addChoices(
              { name: 'GLM-4.7 (Z-AI, balanced)', value: 'z-ai/glm-4.7' },
              { name: 'Minimax M2.1 (creative)', value: 'minimax/minimax-m2.1' }
            )
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('web')
        .setDescription('Generate a complete website')
        .addStringOption((opt) =>
          opt
            .setName('prompt')
            .setDescription('Describe the website (e.g., "portfolio site with blog")')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('theme')
            .setDescription('Visual theme/style (e.g., "dark purple", "minimal")')
            .setRequired(true)
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('web-pro')
        .setDescription('Generate a website with premium AI (premium only)')
        .addStringOption((opt) =>
          opt
            .setName('prompt')
            .setDescription('Describe the website (e.g., "e-commerce site")')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('theme')
            .setDescription('Visual theme/style (e.g., "modern blue", "cottage")')
            .setRequired(true)
        )
        .toJSON(),
    ];

    console.log(`📋 Registering ${commands.length} slash commands:`, commands.map(c => c.name).join(', '));
    
    // Clear global commands to avoid duplicates
    await this.client.application?.commands.set([]);
    console.log(`🧹 Cleared global commands`);
    
    // Register commands per-guild for instant visibility (bypasses Discord's 1hr global cache)
    const guilds = this.client.guilds.cache;
    console.log(`🔄 Registering commands in ${guilds.size} guild(s)...`);
    
    for (const [guildId, guild] of guilds) {
      try {
        await guild.commands.set(commands);
        console.log(`✅ Registered ${commands.length} commands in guild: ${guild.name}`);
      } catch (error) {
        console.error(`❌ Failed to register commands in guild ${guild.name}:`, error);
      }
    }
    
    console.log(`✅ Guild-specific registration complete (instant visibility)`);
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;
    // Allow clear me for all users; other admin commands require admin rights
    const isClear = interaction.commandName === 'clear';
    const sub = isClear && 'getSubcommand' in interaction.options ? (interaction.options as any).getSubcommand(false) : undefined;
    const isUserClear = interaction.commandName === 'clear-context' || (isClear && (!sub || sub === 'me'));
    const adminRequiredCommands = new Set([
      'set-persona',
      'set-chat-model',
      'debug',
      'clear',
      'admin-set-role',
      'admin-set-permission',
      'admin-clear-config',
      'premium-role',
    ]);
    const requiresAdmin = adminRequiredCommands.has(interaction.commandName) && !isUserClear;
    if (requiresAdmin && !this.hasPermission(interaction as any)) {
      await interaction.reply({
        content: 'You do not have permission to run this command.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'set-persona') {
      await this.handleSetPersona(interaction);
      return;
    }

    if (interaction.commandName === 'set-chat-model') {
      await this.handleChatModel(interaction);
      return;
    }

    if (interaction.commandName === 'debug') {
      await this.handleDebugMode(interaction);
      return;
    }

    if (interaction.commandName === 'clear-context') {
      await this.handleClearContext(interaction);
      return;
    }

    if (interaction.commandName === 'clear') {
      const sub = interaction.options.getSubcommand(false);
      if (!sub || sub === 'me') {
        await this.handleClearContext(interaction);
        return;
      }
      if (sub === 'channel') {
        await this.handleClearChannel(interaction);
        return;
      }
      if (sub === 'server') {
        await this.handleClearServer(interaction);
        return;
      }
    }

    if (interaction.commandName === 'admin-set-role') {
      await this.handleAdminSetRole(interaction);
      return;
    }
    if (interaction.commandName === 'admin-set-permission') {
      await this.handleAdminSetPermission(interaction);
      return;
    }
    if (interaction.commandName === 'admin-clear-config') {
      await this.handleAdminClearConfig(interaction);
      return;
    }

    if (interaction.commandName === 'premium-role') {
      await this.handlePremiumRole(interaction);
      return;
    }

    if (interaction.commandName === 'imagine') {
      await this.handleImagine(interaction);
      return;
    }

    if (interaction.commandName === 'flash') {
      await this.handleCodingCommand(interaction, process.env.CODEGEN_MODEL_FLASH || 'google/gemini-3-flash-preview', 'Flash');
      return;
    }

    if (interaction.commandName === 'pro') {
      const selectedModel = interaction.options.getString('model', false) || process.env.CODEGEN_MODEL_PRO || 'google/gemini-3-pro-preview';
      await this.handleCodingCommand(interaction, selectedModel, 'Pro');
      return;
    }

    if (interaction.commandName === 'web') {
      await this.handleWebCommand(interaction, false);
      return;
    }

    if (interaction.commandName === 'web-pro') {
      await this.handleWebCommand(interaction, true);
      return;
    }
  }

  private hasPermission(interaction: ChatInputCommandInteraction): boolean {
    if (this.isOwner(interaction.user.id)) return true;
    if (!interaction.guildId) return false;
    const member = interaction.member;
    // member can be GuildMember or APIGuildMember; in interactions it is GuildMember-like
    return this.adminConfig.isAdmin(interaction.guildId, member as any);
  }

  private isOwner(userId: string, guildOwnerId?: string): boolean {
    if (env.ADMIN_USER_IDS.includes(userId)) return true;
    if (guildOwnerId && guildOwnerId === userId) return true;
    return false;
  }

  private async requirePremium(interaction: ChatInputCommandInteraction): Promise<boolean> {
    // Server owner or ADMIN_USER_IDS always allowed
    if (this.isOwner(interaction.user.id, interaction.guild?.ownerId)) {
      return true;
    }

    // If in guild, check premium role
    if (interaction.guildId) {
      const member = interaction.member as any;
      const premiumRoleId = this.adminConfig.getPremiumRoleId(interaction.guildId);
      
      if (premiumRoleId && member?.roles?.cache?.has?.(premiumRoleId)) {
        return true;
      }
      
      await interaction.reply({ content: 'You need admin privileges or the premium role to use this command.', ephemeral: true });
      return false;
    }

    // DMs - only allow if owner
    await interaction.reply({ content: 'This command is only available in servers.', ephemeral: true });
    return false;
  }

  private async handleSetPersona(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const personaId = interaction.options.getString('persona', true);

    const success = this.promptManager.setPersona(
      interaction.channelId,
      personaId
    );

    if (!success) {
      await interaction.reply({
        content: `Invalid persona. Available personas: ${getAllPersonaIds().join(', ')}`,
        ephemeral: true,
      });
      return;
    }

    const persona = getPersona(personaId);
    await interaction.reply({
      content: `Persona set to **${persona?.displayName || personaId}** for this channel.\n*${persona?.description || ''}*`,
      ephemeral: true,
    });
  }

  /**
   * DEPRECATED: Manual model selection is no longer supported.
   * Model selection is now automatic via RouterService.
   */
  private async handleChatModel(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    await interaction.reply({
      content: `⚠️ **This command is deprecated.**\n\nModel selection is now **automatic** via the 4-tier routing system:\n• **INSTANT** - Fast responses for simple queries\n• **SMART** - General-purpose reasoning\n• **THINKING** - Deep analysis\n• **CODING** - Code generation\n\nThe system automatically selects the best model for each query.`,
      ephemeral: true,
    });
  }

  /**
   * Handle /debug command - set debug information level
   */
  private async handleDebugMode(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const modeInput = interaction.options.getString('mode', true);
    const mode = parseDebugMode(modeInput);

    if (!mode) {
      await interaction.reply({
        content: `Invalid debug mode. Valid options: full, simple, off`,
        ephemeral: true,
      });
      return;
    }

    // Set for guild (or channel if DM)
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    
    setDebugMode(mode, guildId || undefined, channelId);

    const description = getDebugModeDescription(mode);
    await interaction.reply({
      content: `🐛 **Debug mode set to: ${mode.toUpperCase()}**\n\n${description}\n\nThis setting applies to ${guildId ? 'this server' : 'this channel'}.`,
      ephemeral: true,
    });
  }

  /**
   * Admin-only: clear all user contexts in the current channel
   */
  private async handleClearChannel(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server channel.', ephemeral: true });
      return;
    }
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    await this.contextService.clearChannel(guildId, channelId);
    await interaction.reply({
      content: '🧹 Cleared all conversation contexts for this channel.',
      ephemeral: true,
    });
  }

  /**
   * Admin-only: clear all contexts in the guild
   */
  private async handleClearServer(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }
    const guildId = interaction.guildId;
    await this.contextService.clearGuild(guildId);
    await interaction.reply({
      content: '🧹 Cleared all conversation contexts for this server.',
      ephemeral: true,
    });
  }

  /**
   * Handle /clear-context command - explicit context deletion only
   * Scope:
   * - Guilds: delete context for invoking user in THIS channel only
   * - DMs: delete user-scoped context
   */
  private async handleClearContext(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    try {
      const userId = interaction.user.id;
      const guildId = interaction.guildId || undefined;
      const channelId = interaction.channelId;

      if (guildId) {
        await this.contextService.clearUser(userId, channelId, guildId);
        await interaction.reply({
          content: '🧹 Your context for this channel has been cleared. Other users and channels are unaffected.',
          ephemeral: true,
        });
      } else {
        await this.contextService.clearUser(userId);
        await interaction.reply({
          content: '🧹 Your DM context has been cleared.',
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error('Failed to clear context:', error);
      await interaction.reply({
        content: 'Sorry, failed to clear context. Please try again later.',
        ephemeral: true,
      });
    }
  }

  private async handleAdminSetRole(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }
    const role = interaction.options.getRole('role', true);
    this.adminConfig.setRole(interaction.guildId, role.id);
    await interaction.reply({
      content: `✅ Admin role set to @${role.name}. Members with this role can run admin commands.`,
      ephemeral: true,
    });
  }

  private async handleAdminSetPermission(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }
    const permission = interaction.options.getString('permission', true) as any;
    this.adminConfig.setPermission(interaction.guildId, permission);
    await interaction.reply({
      content: `✅ Admin permission set to ${permission}. Members with this permission can run admin commands.`,
      ephemeral: true,
    });
  }

  private async handleAdminClearConfig(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }
    this.adminConfig.clear(interaction.guildId);
    await interaction.reply({
      content: '✅ Admin config cleared. Default requirement is now MANAGE_GUILD.',
      ephemeral: true,
    });
  }

  private async handlePremiumRole(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    if (!this.isOwner(interaction.user.id, interaction.guild?.ownerId) && !this.hasPermission(interaction)) {
      await interaction.reply({ content: 'You do not have permission to manage premium roles.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand(true);

    if (sub === 'set') {
      const role = interaction.options.getRole('role', true);
      this.adminConfig.setPremiumRole(interaction.guildId, role.id);
      await interaction.reply({ content: `✅ Premium role set to ${role}. Members with this role can use premium commands.`, ephemeral: true });
      return;
    }

    if (sub === 'show') {
      const roleId = this.adminConfig.getPremiumRoleId(interaction.guildId);
      const content = roleId ? `Current premium role: <@&${roleId}>` : 'No premium role is set.';
      await interaction.reply({ content, ephemeral: true });
      return;
    }

    if (sub === 'clear') {
      this.adminConfig.clearPremiumRole(interaction.guildId);
      await interaction.reply({ content: '✅ Premium role cleared. Premium commands are currently locked.', ephemeral: true });
      return;
    }
  }

  private async handleImagine(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const allowed = await this.requirePremium(interaction);
    if (!allowed) return;

    const rawPrompt = interaction.options.getString('prompt', true);
    const sizeOption = interaction.options.getString('size', false);

    // Create working message for progress tracking
    const workingMessage = await interaction.reply({ content: '🐍 Starting image generation...', fetchReply: true });
    const progressTracker = ResponseRenderer.createProgressTracker(workingMessage as any, rawPrompt);

    try {
      // Get persona from channel
      const personaId = this.promptManager.getPersona(interaction.channelId);
      const persona = personaId ? getPersona(personaId as any) : null;

      // Enhanced prompt with persona context
      const enhancedPrompt = persona 
        ? `${persona.displayName}'s request: ${rawPrompt}`
        : rawPrompt;

      await progressTracker.addUpdate({
        stage: 'responding',
        message: '🎨 Generating image...',
        details: `Resolution: ${sizeOption || 'auto-detected'}`,
        timestamp: Date.now(),
      });

      let width = 1024;
      let height = 1024;
      
      if (sizeOption) {
        const [w, h] = sizeOption.split('x').map(Number);
        width = w;
        height = h;
      } else {
        const resolution = this.imageService.parseResolutionFromPrompt(enhancedPrompt);
        width = resolution.width;
        height = resolution.height;
      }

      const result = await this.imageService.generateImage({
        prompt: enhancedPrompt,
        width,
        height,
      });

      await progressTracker.complete();
      progressTracker.close();

      const attachment = new AttachmentBuilder(result.imageBuffer, { name: 'image.png' });

      // Use ResponseRenderer for proper formatting
      const metadata: ResponseMetadata = {
        plannedActions: [],
        responseModel: process.env.IMAGE_MODEL || 'flux-pro-realism',
        startTime: Date.now(),
        routingDecision: {
          tier: 'SMART' as any,
          modelId: process.env.IMAGE_MODEL || 'flux-pro-realism',
          modelConfig: { model: process.env.IMAGE_MODEL || 'flux-pro-realism' } as any,
          routingMethod: 'heuristic',
          confidence: 100,
          routingReason: 'Image generation via /imagine command',
          flags: { needsTools: false, needsSearch: false, containsCode: false, needsLongContext: false, explicitDepthRequest: false, isGreeting: false, isShortQuery: false },
        },
        llmMetadata: undefined,
      };

      const debugMode = getDebugMode(interaction.guildId || undefined, interaction.channelId);
      const rendered = ResponseRenderer.render(
        metadata,
        `🎨 **Image Generated** (${result.resolution.width}x${result.resolution.height})\n\n*Prompt:* ${rawPrompt}`,
        interaction.guildId || undefined,
        interaction.channelId
      );

      await workingMessage.edit({
        content: rendered.responseContent,
        embeds: debugMode !== 'off' ? [rendered.systemEmbed] : [],
        files: [attachment],
      });
    } catch (error) {
      console.error('Failed to generate image via slash command:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await progressTracker.error('Image generation failed', errorMsg);
    }
  }

  private async handleCodingCommand(
    interaction: ChatInputCommandInteraction,
    modelId: string,
    label: string
  ): Promise<void> {
    const allowed = await this.requirePremium(interaction);
    if (!allowed) return;

    const rawPrompt = interaction.options.getString('prompt', true);

    // Defer reply to avoid timeout (must respond within 3 seconds)
    await interaction.deferReply();
    
    // Create working message for progress tracking (MUST use embed like message handler)
    const workingEmbed = ResponseRenderer.createWorkingEmbed(rawPrompt);
    await interaction.editReply({ embeds: [workingEmbed] });
    const workingMessage = await interaction.fetchReply();
    const progressTracker = ResponseRenderer.createProgressTracker(workingMessage as any, rawPrompt);

    try {
      // Get persona and context
      const personaId = this.promptManager.getPersona(interaction.channelId);
      const persona = personaId ? getPersona(personaId as any) : null;

      // Enhanced prompt with persona context
      const enhancedPrompt = persona 
        ? `${persona.displayName} requests: ${rawPrompt}`
        : rawPrompt;

      await progressTracker.addUpdate({
        stage: 'planning',
        message: '🎯 Analyzing project requirements...',
        timestamp: Date.now(),
      });

      const projectDecision = ProjectRouter.route(enhancedPrompt);
      console.log('📦 Project Type:', projectDecision.projectType);
      console.log('📦 Preview Allowed:', projectDecision.previewAllowed);
      console.log('📦 Requires Build:', projectDecision.requiresBuild);
      console.log('📦 Matched Keywords:', projectDecision.matchedKeywords.join(', '));
      
      const job = createJob(projectDecision, {
        userMessage: enhancedPrompt,
        userId: interaction.user.id,
        guildId: interaction.guildId || undefined,
        channelId: interaction.channelId,
      });

      console.log(`📋 Job created: ${job.jobId}`);

      setJobOutputToLogsDir(
        job,
        interaction.user.username,
        interaction.guild?.name || null,
        (interaction.channel as any)?.name || 'unknown'
      );

      ensureJobDirs(job);
      writeJobLog(job, `${label} codegen requested by ${interaction.user.id}`);
      writeJobLog(job, `Message: "${enhancedPrompt}"`);
      writeJobLog(job, `Project type: ${job.projectType}`);
      writeJobLog(job, `Router decision: ${JSON.stringify(projectDecision)}`);

      const cachingAvailable = modelSupportsCaching(modelId);
      const useCaching = cachingAvailable && process.env.OPENROUTER_PROMPT_CACHE !== '0';
      job.diagnostics.pipeline = useCaching ? 'direct_cached' : 'direct';
      job.diagnostics.cachingCapable = cachingAvailable;

      writeJobLog(job, `Pipeline: ${useCaching ? 'direct_cached' : 'direct'}`);
      writeJobLog(job, `Caching: ${useCaching ? 'enabled' : 'disabled'}`);
      writeJobLog(job, `Coding model: ${modelId}`);

      console.log(`🚀 ${label}: Using ${useCaching ? 'cached' : 'direct'} generation (caching: ${useCaching ? 'enabled' : 'disabled'})`);
      
      await progressTracker.addUpdate({
        stage: 'responding',
        message: '💻 Generating code...',
        details: `Project: ${projectDecision.projectType} | Model: ${modelId}`,
        timestamp: Date.now(),
      });

      markStageStart(job, 'codegen_direct');
      let codegenMetadata;

      if (useCaching) {
        codegenMetadata = await runDirectCachedCodegen(job, this.aiService, modelId, async (message, details) => {
          await progressTracker.addUpdate({
            stage: 'responding',
            message: `💻 ${message}`,
            details,
            timestamp: Date.now(),
          });
        });
      } else {
        codegenMetadata = await runDirectCodegen(job, this.aiService, modelId, async (message, details) => {
          await progressTracker.addUpdate({
            stage: 'responding',
            message: `💻 ${message}`,
            details,
            timestamp: Date.now(),
          });
        });
      }
      
      updateJobStatus(job, 'generated');
      markStageEnd(job, 'codegen_direct');

      console.log(`💻 ${label} codegen complete: ${job.codegenResult?.files.length} files`);
      console.log(`   Notes: ${job.codegenResult?.notes}`);

      await progressTracker.addUpdate({
        stage: 'responding',
        message: '📦 Packaging files...',
        details: `${job.codegenResult?.files.length || 0} files generated`,
        timestamp: Date.now(),
      });

      markStageStart(job, 'output_copy');
      const fileCount = copyWorkspaceToOutput(job);
      writeJobLog(job, `Copied ${fileCount} files to output directory`);
      markStageEnd(job, 'output_copy');

      markStageStart(job, 'zip_create');
      let zipPath: string | null = null;
      try {
        zipPath = await createZipArchive(job);
        writeJobLog(job, `Created ZIP: ${zipPath}`);
      } catch (zipError) {
        console.error('Zip creation failed:', zipError);
        writeJobLog(job, 'Zip creation failed');
      }
      markStageEnd(job, 'zip_create');

      updateJobStatus(job, 'done');
      await progressTracker.complete();
      progressTracker.close();

      // Build response with proper formatting
      const generatedFiles = job.codegenResult?.files || [];
      const filePreview = generatedFiles
        .slice(0, 5)
        .map(f => `• ${f.path}`)
        .join('\n');

      const finalResponse = [
        `**${label} Code Generation Complete** 🎉`,
        '',
        `**Project Type:** ${projectDecision.projectType}`,
        `**Files Generated:** ${generatedFiles.length}`,
        `**Model:** ${modelId}`,
        '',
        job.codegenResult?.notes ? `**Notes:** ${job.codegenResult.notes}` : null,
        '',
        generatedFiles.length > 0 ? '**Files:**' : null,
        filePreview,
        generatedFiles.length > 5 ? `*...and ${generatedFiles.length - 5} more*` : null,
      ]
        .filter(Boolean)
        .join('\n');

      // Use ResponseRenderer for proper formatting with debug info
      const metadata: ResponseMetadata = {
        plannedActions: [],
        responseModel: modelId,
        startTime: Date.now(),
        routingDecision: {
          tier: 'CODING' as any,
          modelId,
          modelConfig: { model: modelId } as any,
          routingMethod: 'heuristic',
          confidence: 100,
          routingReason: `${label} command with ${useCaching ? 'cached' : 'direct'} pipeline`,
          flags: { needsTools: false, needsSearch: false, containsCode: true, needsLongContext: true, explicitDepthRequest: false, isGreeting: false, isShortQuery: false },
        },
        llmMetadata: undefined,
      };

      const debugMode = getDebugMode(interaction.guildId || undefined, interaction.channelId);
      const rendered = ResponseRenderer.render(
        metadata,
        finalResponse,
        interaction.guildId || undefined,
        interaction.channelId
      );

      const files = zipPath ? [new AttachmentBuilder(fs.readFileSync(zipPath), { name: `${job.jobId}.zip` })] : [];

      await workingMessage.edit({
        content: rendered.responseContent,
        embeds: debugMode !== 'off' ? [rendered.systemEmbed] : [],
        files,
      });
    } catch (error) {
      console.error(`${label} codegen slash command failed:`, error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await progressTracker.error('Code generation failed', errorMsg);
    }
  }

  /**
   * Handle /web and /web-pro commands
   */
  private async handleWebCommand(
    interaction: ChatInputCommandInteraction,
    isPro: boolean
  ): Promise<void> {
    // Check premium gate for web-pro
    if (isPro) {
      const allowed = await this.requirePremium(interaction);
      if (!allowed) return;
    }

    const rawPrompt = interaction.options.getString('prompt', true);
    const theme = interaction.options.getString('theme', true);

    const intent = this.detectWebIntent(rawPrompt);
    const intentSuffix = intent.explicit
      ? `Please produce ${intent.pages} pages as requested.`
      : `Site intent: ${intent.siteType || 'general'}; target at least ${intent.pages} pages. Suggested pages: ${intent.suggestedPages.join(', ')}.`;
    const enhancedPrompt = `${rawPrompt}\n\n${intentSuffix}`;
    const mode = isPro ? 'web-pro' : 'web';
    const label = isPro ? 'Web Pro' : 'Web';

    console.log(`[/web] Command invoked by ${interaction.user.username} (${interaction.user.id})`);
    console.log(`[/web] Mode: ${mode}, Theme: ${theme}`);
    console.log(`[/web] Prompt: "${rawPrompt.slice(0, 100)}${rawPrompt.length > 100 ? '...' : ''}"`);
    console.log(`[/web] Intent: ${intent.siteType || 'general'} -> ${intent.pages} pages (${intent.reason})`);

    // Check if user already has a job queued
    if (webQueue.hasUserInQueue(interaction.user.id)) {
      console.log(`[/web] User ${interaction.user.id} already has job in queue`);
      await interaction.reply({
        content: '⚠️ You already have a website generation job in progress or queued.',
        ephemeral: true,
      });
      return;
    }

    // Defer reply to avoid timeout (must respond within 3 seconds)
    await interaction.deferReply();
    console.log('[/web] deferReply OK');
    
    // Create working message for progress tracking (EXACT same as /flash - MUST use embed)
    const workingEmbed = ResponseRenderer.createWorkingEmbed(rawPrompt);
    await interaction.editReply({ embeds: [workingEmbed] });
    console.log('[/web] Initial embed created');

    // Fetch reply for diagnostics on edit availability
    const workingMessage = await interaction.fetchReply();
    console.log('[/web] fetchReply returned:', {
      typeofEdit: typeof (workingMessage as any)?.edit,
      ctor: (workingMessage as any)?.constructor?.name,
      hasResourceEdit: Boolean((workingMessage as any)?.resource?.message?.edit),
    });

    // Use interaction-safe tracker to ensure edit works
    const progressTracker = ResponseRenderer.createProgressTrackerForInteraction(interaction as any, rawPrompt);
    console.log('[/web] ProgressTracker created');

    // Immediate first progress update so user sees loader and text instantly
    await progressTracker.addUpdate({
      stage: 'planning',
      message: '📋 Queued and preparing generation...',
      timestamp: Date.now(),
    });
    console.log('[/web] First progress update added');

    // Show queue status if needed
    const queueStatus = webQueue.getQueueStatus();
    if (queueStatus.queue.length > 0 || queueStatus.active) {
      console.log(`[/web] Queue status: active=${queueStatus.active}, queued=${queueStatus.queue.length}`);
      await progressTracker.addUpdate({
        stage: 'planning',
        message: `📋 Queued... ${queueStatus.active ? `(Active: ${queueStatus.active})` : ''}`,
        timestamp: Date.now(),
      });
    }

    const sendFollowUpSafe = async (payload: any): Promise<boolean> => {
      try {
        await interaction.followUp(payload);
        return true;
      } catch (followErr) {
        console.error('[/web] followUp failed, attempting channel send:', followErr);
        const channel: any = interaction.channel;
        if (channel && typeof channel.send === 'function') {
          try {
            await channel.send({
              ...payload,
              allowedMentions: { repliedUser: false },
            });
            console.log('[/web] followUp fallback sent via channel');
            return true;
          } catch (channelErr) {
            console.error('[/web] Channel fallback failed:', channelErr);
          }
        }
        return false;
      }
    };

    // Enqueue the job
    console.log(`[/web] Enqueueing job for user ${interaction.user.id}`);
    await webQueue.enqueue({
      userId: interaction.user.id,
      username: interaction.user.username,
      execute: async () => {
        console.log(`[/web] job started (mode=${mode}, user=${interaction.user.username}, theme=${theme})`);
        const jobStartTime = Date.now();
        try {
          // EXACT same flow as /flash code generation
          await progressTracker.addUpdate({
            stage: 'planning',
            message: '🎯 Analyzing project requirements...',
            timestamp: Date.now(),
          });

          await progressTracker.addUpdate({
            stage: 'responding',
            message: '💻 Generating code...',
            details: `Project: ${mode === 'web-pro' ? 'website-pro' : 'website'} | Theme: ${theme}`,
            timestamp: Date.now(),
          });

          console.log('[/web] Calling runWebGeneration...');

          // Run the generation with progress callbacks (showing ALL stages)
          const result = await runWebGeneration(
            enhancedPrompt,
            theme,
            mode,
            interaction.user.id,
            interaction.guildId,
            interaction.channelId,
            interaction.user.username,
            interaction.guild?.name || null,
            (interaction.channel as any)?.name || 'unknown',
            async (progress) => {
              // Update with coding-style messages (💻 prefix for consistency)
              console.log(`[/web] Progress: ${progress.stage} - ${progress.message}`);
              await progressTracker.addUpdate({
                stage: 'responding',
                message: `💻 ${progress.message}`,
                details: progress.details,
                timestamp: Date.now(),
              });
            }
          );

          const jobDuration = Date.now() - jobStartTime;
          console.log(`[/web] runWebGeneration completed in ${jobDuration}ms`);
          console.log(`[/web] Result: success=${result.success}, pages=${result.stats.generatedPages}`);

          if (!result.success) {
            console.error(`[/web] Generation failed: ${result.error}`);
            await progressTracker.error('Generation failed', result.error || 'Unknown error');
            return;
          }

          console.log(`🌐 ${label} generation complete for ${interaction.user.username}`);
          console.log(`   Pages generated: ${result.stats.generatedPages}`);
          console.log(`   Dist dir: ${result.distDir}`);
          console.log(`   Zip path: ${result.zipPath || 'none'}`);

          // Mark progress tracker as complete before editing final message
          await progressTracker.complete('Generation complete. Uploading files...');
          progressTracker.close();

          // Build final response summary embed for follow-up (zip sent separately)
          const tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
          const modelId = mode === 'web-pro' ? 'google/gemini-3-flash-preview' : 'FREE';
          const estimatedCost = calculateCost(tokenUsage, modelId);

          const metadata: ResponseMetadata = {
            plannedActions: [
              { type: 'tool', toolName: 'generate-website', reasoning: `Generate ${result.stats.intentPages || intent.pages}-page website` },
              { type: 'tool', toolName: 'generate-website', reasoning: 'Create foundation' },
              { type: 'tool', toolName: 'generate-website', reasoning: 'Generate pages' },
              { type: 'tool', toolName: 'generate-website', reasoning: 'Package files' }
            ],
            planReasoning: `Intent: ${intent.siteType || 'general'} → ${intent.pages} pages (${intent.reason}). Tokens: ${tokenUsage.totalTokens || 0}, Cost: ~$${estimatedCost.toFixed(4)}`,
            responseModel: modelId,
            startTime: Date.now(),
            routingDecision: {
              tier: 'CODING' as any,
              modelId,
              modelConfig: { model: modelId } as any,
              routingMethod: 'heuristic',
              confidence: 100,
              routingReason: `${label} website generation command`,
              flags: { needsTools: false, needsSearch: false, containsCode: true, needsLongContext: true, explicitDepthRequest: false, isGreeting: false, isShortQuery: false },
            },
            llmMetadata: {
              planningCall: undefined,
              executionCalls: [],
              toolExecutions: [],
              responseCall: undefined,
              totalTokens: tokenUsage.totalTokens || 0,
              totalPromptTokens: tokenUsage.promptTokens || 0,
              totalCompletionTokens: tokenUsage.completionTokens || 0,
              totalLLMLatencyMs: 0,
              totalToolLatencyMs: 0,
              totalLatencyMs: 0,
              totalCost: estimatedCost,
              totalCalls: 0,
              modelsUsed: [modelId],
            },
          };

          const debugMode = getDebugMode(interaction.guildId || undefined, interaction.channelId);
          const rendered = ResponseRenderer.render(
            metadata,
            `**${label} Code Generation Complete** 🎉\n\n**Prompt:** ${rawPrompt}\n**Theme:** ${theme}\n**Intent:** ${intent.siteType || 'general'} → ${intent.pages} pages` + (intent.reason ? `\n**Reason:** ${intent.reason}` : ''),
            interaction.guildId || undefined,
            interaction.channelId
          );

          const summaryEmbed = new EmbedBuilder()
            .setTitle(`${label} website ready`)
            .setDescription('Your website has been generated. Download the ZIP below.')
            .addFields(
              { name: 'Prompt', value: rawPrompt.length > 300 ? `${rawPrompt.slice(0, 300)}...` : rawPrompt },
              { name: 'Theme', value: theme, inline: true },
              { name: 'Pages', value: `${result.stats.generatedPages} (intent ${intent.pages})`, inline: true },
              { name: 'Mode', value: mode, inline: true }
            )
            .setFooter({ text: `Output folder: ${result.distDir}` })
            .setColor(0x00ff00);

          const files = result.zipPath ? [new AttachmentBuilder(fs.readFileSync(result.zipPath), { name: `${mode}-website.zip` })] : [];

          console.log(`[/web] Sending follow-up with ${files.length} attachment(s)`);
          const followPayload = {
            content: rendered.responseContent,
            embeds: debugMode !== 'off' ? [rendered.systemEmbed, summaryEmbed] : [summaryEmbed],
            files,
          } as const;
          const sent = await sendFollowUpSafe(followPayload);
          if (sent) {
            console.log(`✅ ${label} complete, zip sent${files.length ? '' : ' (no attachment)'}`);
          } else {
            console.error('[/web] Failed to deliver zip follow-up via interaction or channel');
          }
        } catch (error) {
          const jobDuration = Date.now() - jobStartTime;
          console.error(`[/web] ✗ Job failed after ${jobDuration}ms:`, error);
          if (error instanceof Error) {
            console.error('[/web] Error stack:', error.stack);
          }
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          await progressTracker.error('Website generation failed', errorMsg);
          progressTracker.close();

          const errorSent = await sendFollowUpSafe({ content: `❌ Website generation failed: ${errorMsg}` });
          if (!errorSent) {
            console.error('[/web] Failed to deliver error follow-up via interaction or channel');
          }
        }
      },
    });

    console.log('[/web] queue enqueue OK (len pending logged in webQueue)');
    console.log('[/web] handler returning');
  }

  /**
   * Infer intent for web generation: page count, site type, suggested pages
   */
  private detectWebIntent(prompt: string): { pages: number; reason: string; explicit: boolean; siteType?: 'games' | 'docs' | 'general'; suggestedPages: string[] } {
    const lower = prompt.toLowerCase();

    // explicit pages
    const numberMatch = prompt.match(/(\d+)\s*pages?/i);
    if (numberMatch) {
      const count = Math.max(1, Math.min(50, parseInt(numberMatch[1], 10)));
      return {
        pages: count,
        reason: `User explicitly requested ${count} pages`,
        explicit: true,
        siteType: /game|arcade|pong|snake|breakout|tetris|conway|life/.test(lower) ? 'games' : /knowledge\s*base|docs|documentation|wiki|help\s*center|guide|tutorial/.test(lower) ? 'docs' : 'general',
        suggestedPages: [],
      };
    }

    const gameKeywords = /(snake|pong|breakout|tetris|conway|game of life|arcade|minigame|mini-game|games?)/i;
    if (gameKeywords.test(lower)) {
      const pages = Math.max(6, 6);
      return {
        pages,
        reason: 'Detected games/arcade intent; ensuring multi-page structure',
        explicit: false,
        siteType: 'games',
        suggestedPages: ['Home', 'Games', 'Snake', 'Pong', 'Conway', 'About/Contact'],
      };
    }

    if (/knowledge\s*base|docs|documentation|wiki|help\s*center|guide|tutorial/.test(lower)) {
      const pages = 12;
      return {
        pages,
        reason: 'Detected knowledgebase/docs intent',
        explicit: false,
        siteType: 'docs',
        suggestedPages: ['Home', 'Docs', 'Guides', 'API', 'FAQ', 'Contact'],
      };
    }

    return {
      pages: 6,
      reason: 'Default website intent',
      explicit: false,
      siteType: 'general',
      suggestedPages: ['Home', 'About', 'Services', 'Gallery', 'Blog', 'Contact'],
    };
  }


}
