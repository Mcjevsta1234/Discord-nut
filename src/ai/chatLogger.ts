import fs from 'fs';
import path from 'path';

type GuildId = string | null | undefined;
type ChannelId = string | null | undefined;

export class ChatLogger {
  private baseDir: string;

  constructor(baseDir: string = 'logs') {
    this.baseDir = baseDir;
  }

  private getDateString(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private getFilePath(guildId: GuildId, channelId: ChannelId, userId: string): string {
    const dateStr = this.getDateString();
    const subdir = guildId
      ? path.join(
          this.baseDir,
          'guilds',
          String(guildId),
          'channels',
          String(channelId ?? 'unknown'),
          'users',
          String(userId)
        )
      : path.join(this.baseDir, 'dms', 'users', String(userId));
    return path.join(subdir, `${dateStr}.txt`);
  }

  private ensureDir(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  logUserMessage(username: string, message: string, guildId: GuildId, channelId: ChannelId, userId: string): void {
    try {
      const filePath = this.getFilePath(guildId, channelId, userId);
      this.ensureDir(filePath);
      const cleanMessage = this.cleanNewlines(message);
      fs.appendFileSync(filePath, `${username}: ${cleanMessage}\n`);
    } catch (err) {
      // Logging errors should never crash the bot; swallow silently.
    }
  }

  logBotReply(reply: string, guildId: GuildId, channelId: ChannelId, userId: string): void {
    try {
      const filePath = this.getFilePath(guildId, channelId, userId);
      this.ensureDir(filePath);
      const cleanReply = this.cleanNewlines(reply);
      fs.appendFileSync(filePath, `bot: ${cleanReply}\n`);
    } catch (err) {
      // Swallow logging errors
    }
  }

  private cleanNewlines(text: string): string {
    // Keep plain text readability; collapse CRLFs and trim trailing spaces.
    return (text ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
