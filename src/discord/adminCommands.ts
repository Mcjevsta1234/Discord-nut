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
import { FileContextManager } from '../ai/fileContextManager';
import { getAllPersonaIds, getPersona } from '../personas.config';
import { setDebugMode, parseDebugMode, getDebugMode, getDebugModeDescription } from './debugMode';

type PromptAction = 'replace' | 'append' | 'clear';

export class AdminCommandHandler {
  private client: Client;
  private promptManager: PromptManager;
  private fileContextManager: FileContextManager;

  constructor(client: Client, promptManager: PromptManager) {
    this.client = client;
    this.promptManager = promptManager;
    this.fileContextManager = new FileContextManager();
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
      // User-accessible clear command (safe for repeated use)
      new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear YOUR stored conversation context for this channel or DM')
        .addStringOption((option) =>
          option
            .setName('target')
            .setDescription('Who to clear (only "me")')
            .addChoices({ name: 'me', value: 'me' })
            .setRequired(false)
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
    // Allow clear commands for all users; other admin commands require ManageGuild
    const isClearContext = interaction.commandName === 'clear-context' || interaction.commandName === 'clear';
    if (!isClearContext && !this.hasPermission(interaction)) {
      await interaction.reply({
        content: 'You need the Manage Server permission to run this command.',
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
      // Optionally check target; only 'me' is supported
      const target = interaction.options.getString('target') || 'me';
      if (target !== 'me') {
        await interaction.reply({
          content: 'Only your own context can be cleared (use target: me).',
          ephemeral: true,
        });
        return;
      }
      await this.handleClearContext(interaction);
      return;
    }
  }

  private hasPermission(interaction: ChatInputCommandInteraction): boolean {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return true;
    }
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
}
