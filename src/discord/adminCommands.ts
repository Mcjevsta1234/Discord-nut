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

type PromptAction = 'replace' | 'append' | 'clear';

export class AdminCommandHandler {
  private client: Client;
  private promptManager: PromptManager;

  constructor(client: Client, promptManager: PromptManager) {
    this.client = client;
    this.promptManager = promptManager;
  }

  async registerCommands(): Promise<void> {
    const commands: RESTPostAPIApplicationCommandsJSONBody[] = [
      new SlashCommandBuilder()
        .setName('set-system-prompt')
        .setDescription('Set or adjust the system prompt for this channel')
        .addStringOption((option) =>
          option
            .setName('action')
            .setDescription('How to apply the prompt (replace, append, clear)')
            .setRequired(true)
            .addChoices(
              { name: 'replace', value: 'replace' },
              { name: 'append', value: 'append' },
              { name: 'clear', value: 'clear' }
            )
        )
        .addStringOption((option) =>
          option
            .setName('prompt')
            .setDescription('Prompt text (required for replace/append)')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
        .setName('set-trigger-names')
        .setDescription('Set trigger names for this channel')
        .addStringOption((option) =>
          option
            .setName('action')
            .setDescription('How to apply the trigger names (replace, append, clear)')
            .setRequired(true)
            .addChoices(
              { name: 'replace', value: 'replace' },
              { name: 'append', value: 'append' },
              { name: 'clear', value: 'clear' }
            )
        )
        .addStringOption((option) =>
          option
            .setName('names')
            .setDescription('Comma-separated trigger names (required for replace/append)')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .toJSON(),
    ];

    await this.client.application?.commands.set(commands);
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;
    if (!this.hasPermission(interaction)) {
      await interaction.reply({
        content: 'You need the Manage Server permission to run this command.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'set-system-prompt') {
      await this.handleSystemPrompt(interaction);
      return;
    }

    if (interaction.commandName === 'set-chat-model') {
      await this.handleChatModel(interaction);
      return;
    }

    if (interaction.commandName === 'set-trigger-names') {
      await this.handleTriggerNames(interaction);
    }
  }

  private hasPermission(interaction: ChatInputCommandInteraction): boolean {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return true;
    }
    return false;
  }

  private async handleSystemPrompt(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const action = interaction.options.getString('action', true) as PromptAction;
    const prompt = interaction.options.getString('prompt');

    if ((action === 'replace' || action === 'append') && !prompt?.trim()) {
      await interaction.reply({
        content: 'Please provide prompt text for replace or append.',
        ephemeral: true,
      });
      return;
    }

    this.promptManager.updateSystemPrompt(
      interaction.channelId,
      action,
      prompt || ''
    );

    await interaction.reply({
      content:
        action === 'clear'
          ? 'System prompt cleared for this channel.'
          : `System prompt ${action}d for this channel.`,
      ephemeral: true,
    });
  }

  private async handleChatModel(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const model = interaction.options.getString('model', true);

    if (!config.openRouter.allowedChatModels.includes(model)) {
      await interaction.reply({
        content: `Model not allowed. Choose one of: ${config.openRouter.allowedChatModels.join(
          ', '
        )}.`,
        ephemeral: true,
      });
      return;
    }

    this.promptManager.updateChatModel(interaction.channelId, model);

    await interaction.reply({
      content: `Chat model set to \`${model}\` for this channel.`,
      ephemeral: true,
    });
  }

  private async handleTriggerNames(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const action = interaction.options.getString('action', true) as PromptAction;
    const namesInput = interaction.options.getString('names') || '';
    const parsedNames = namesInput
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);

    if (
      (action === 'replace' || action === 'append') &&
      parsedNames.length === 0
    ) {
      await interaction.reply({
        content: 'Please provide at least one trigger name for replace or append.',
        ephemeral: true,
      });
      return;
    }

    this.promptManager.updateTriggerNames(
      interaction.channelId,
      action,
      parsedNames
    );

    const formattedNames =
      parsedNames.length > 0 ? parsedNames.map((n) => `\`${n}\``).join(', ') : '';

    await interaction.reply({
      content:
        action === 'clear'
          ? 'Trigger names cleared for this channel.'
          : `Trigger names ${action}d for this channel: ${formattedNames}`,
      ephemeral: true,
    });
  }
}
