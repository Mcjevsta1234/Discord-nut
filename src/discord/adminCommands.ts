import {
  ChatInputCommandInteraction,
  Client,
  Interaction,
  PermissionFlagsBits,
  RESTPostAPIApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from 'discord.js';
import { config } from '../config';
import { PromptManager } from './promptManager';
import { AdminConfigManager } from './adminConfig';
import { FileContextManager } from '../ai/fileContextManager';
import { getAllPersonaIds, getPersona } from '../personas.config';
import { setDebugMode, parseDebugMode, getDebugMode, getDebugModeDescription } from './debugMode';

type PromptAction = 'replace' | 'append' | 'clear';

export class AdminCommandHandler {
  private client: Client;
  private promptManager: PromptManager;
  private fileContextManager: FileContextManager;
  private adminConfig: AdminConfigManager;

  constructor(client: Client, promptManager: PromptManager) {
    this.client = client;
    this.promptManager = promptManager;
    this.fileContextManager = new FileContextManager();
    this.adminConfig = new AdminConfigManager();
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
    ];

    await this.client.application?.commands.set(commands);
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;
    // Allow clear me for all users; other admin commands require admin rights
    const isClear = interaction.commandName === 'clear';
    const sub = isClear && 'getSubcommand' in interaction.options ? (interaction.options as any).getSubcommand(false) : undefined;
    const isUserClear = interaction.commandName === 'clear-context' || (isClear && (!sub || sub === 'me'));
    const requiresAdmin = !isUserClear;
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
  }

  private hasPermission(interaction: ChatInputCommandInteraction): boolean {
    if (!interaction.guildId) return false;
    const member = interaction.member;
    // member can be GuildMember or APIGuildMember; in interactions it is GuildMember-like
    return this.adminConfig.isAdmin(interaction.guildId, member as any);
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
    await this.fileContextManager.deleteChannelContexts(guildId, channelId);
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
    await this.fileContextManager.deleteGuildContexts(guildId);
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
        await this.fileContextManager.deleteContext(userId, channelId, guildId);
        await interaction.reply({
          content: '🧹 Your context for this channel has been cleared. Other users and channels are unaffected.',
          ephemeral: true,
        });
      } else {
        await this.fileContextManager.deleteContext(userId);
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
}
