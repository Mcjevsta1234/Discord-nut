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
import { getAllPersonaIds, getPersona } from '../personas.config';

type PromptAction = 'replace' | 'append' | 'clear';

export class AdminCommandHandler {
  private client: Client;
  private promptManager: PromptManager;

  constructor(client: Client, promptManager: PromptManager) {
    this.client = client;
    this.promptManager = promptManager;
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

    if (interaction.commandName === 'set-persona') {
      await this.handleSetPersona(interaction);
      return;
    }

    if (interaction.commandName === 'set-chat-model') {
      await this.handleChatModel(interaction);
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
}
