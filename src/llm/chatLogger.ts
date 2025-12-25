import fs from 'fs';
import path from 'path';

/**
 * ChatLogger: Fire-and-forget conversation and image logging
 * 
 * Design principles:
 * - All logging operations are synchronous but wrapped in try-catch
 * - Logging failures NEVER affect bot behavior or message handling
 * - Callers should wrap calls in setImmediate() for non-blocking execution
 * - No async operations to avoid race conditions with message flow
 * - All file writes use synchronous fs methods for reliability
 * 
 * Directory structure:
 * logs/{username}/{guildName}/{channelName}/YYYY-MM-DD.txt
 * logs/{username}/{guildName}/{channelName}/images/
 */
export class ChatLogger {
  private baseDir: string;
  private userIdMap: Map<string, string>; // username -> userId mapping for collision detection

  constructor(baseDir: string = 'logs') {
    this.baseDir = baseDir;
    this.userIdMap = new Map();
  }

  /**
   * Sanitize names for filesystem use
   * - lowercase
   * - spaces to underscores
   * - remove invalid characters
   * - max 64 chars
   */
  private sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 64);
  }

  /**
   * Get sanitized username with collision handling
   * Appends __{last6OfUserId} if username collision detected
   */
  private getSanitizedUsername(username: string, userId: string): string {
    const sanitized = this.sanitizeName(username);
    const userDir = path.join(this.baseDir, sanitized);
    
    // Check for existing username folder
    if (fs.existsSync(userDir)) {
      const mappedUserId = this.userIdMap.get(sanitized);
      
      // If no mapping exists, read from filesystem marker
      if (!mappedUserId) {
        const markerPath = path.join(userDir, '.userid');
        if (fs.existsSync(markerPath)) {
          const storedId = fs.readFileSync(markerPath, 'utf-8').trim();
          this.userIdMap.set(sanitized, storedId);
          
          // Collision detected
          if (storedId !== userId) {
            const suffix = userId.slice(-6);
            return `${sanitized}__${suffix}`;
          }
        } else {
          // No marker, create one
          fs.writeFileSync(markerPath, userId, 'utf-8');
          this.userIdMap.set(sanitized, userId);
        }
      } else if (mappedUserId !== userId) {
        // Collision detected via in-memory map
        const suffix = userId.slice(-6);
        return `${sanitized}__${suffix}`;
      }
    } else {
      // New user, create directory and marker
      fs.mkdirSync(userDir, { recursive: true });
      const markerPath = path.join(userDir, '.userid');
      fs.writeFileSync(markerPath, userId, 'utf-8');
      this.userIdMap.set(sanitized, userId);
    }
    
    return sanitized;
  }

  private getDateString(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private getFilePath(
    username: string,
    userId: string,
    guildName: string | null,
    channelName: string
  ): string {
    const dateStr = this.getDateString();
    const sanitizedUsername = this.getSanitizedUsername(username, userId);
    const sanitizedGuildName = guildName ? this.sanitizeName(guildName) : 'dms';
    const sanitizedChannelName = this.sanitizeName(channelName);
    
    const subdir = path.join(
      this.baseDir,
      sanitizedUsername,
      sanitizedGuildName,
      sanitizedChannelName
    );
    
    return path.join(subdir, `${dateStr}.txt`);
  }

  private ensureDir(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  logUserMessage(
    username: string,
    message: string,
    userId: string,
    guildName: string | null,
    channelName: string
  ): void {
    try {
      const filePath = this.getFilePath(username, userId, guildName, channelName);
      this.ensureDir(filePath);
      const cleanMessage = this.cleanNewlines(message);
      fs.appendFileSync(filePath, `${username}: ${cleanMessage}\n`);
    } catch (err) {
      // Logging errors should never crash the bot; swallow silently.
    }
  }

  logBotReply(
    reply: string,
    username: string,
    userId: string,
    guildName: string | null,
    channelName: string
  ): void {
    try {
      const filePath = this.getFilePath(username, userId, guildName, channelName);
      this.ensureDir(filePath);
      const cleanReply = this.cleanNewlines(reply);
      fs.appendFileSync(filePath, `bot: ${cleanReply}\n`);
    } catch (err) {
      // Swallow logging errors
    }
  }

  /**
   * Save generated image to disk and log reference with prompt
   * @returns The relative path to the saved image
   */
  logImageGeneration(
    buffer: Buffer,
    prompt: string,
    username: string,
    userId: string,
    guildName: string | null,
    channelName: string
  ): string {
    try {
      // Build paths
      const logFilePath = this.getFilePath(username, userId, guildName, channelName);
      const logDir = path.dirname(logFilePath);
      const imagesDir = path.join(logDir, 'images');

      // Ensure images directory exists
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }

      // Generate filename with timestamp
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
      const sanitizedUsername = this.sanitizeName(username);
      const filename = `${sanitizedUsername}-${dateStr}-${timeStr}.png`;
      const fullPath = path.join(imagesDir, filename);

      // Save image to disk
      fs.writeFileSync(fullPath, buffer);

      // Log both prompt and image reference
      const relativePath = `images/${filename}`;
      this.ensureDir(logFilePath);
      const cleanPrompt = this.cleanNewlines(prompt);
      fs.appendFileSync(logFilePath, `bot: [image prompt: ${cleanPrompt}]\n`, 'utf-8');
      fs.appendFileSync(logFilePath, `bot: [image generated: ${relativePath}]\n`, 'utf-8');

      return relativePath;
    } catch (err) {
      // Swallow logging errors, return empty string
      return '';
    }
  }

  /**
   * Log code generation request with full details
   */
  logCodeGeneration(
    prompt: string,
    jobId: string,
    projectType: string,
    outputLocation: string,
    filesGenerated: string[],
    username: string,
    userId: string,
    guildName: string | null,
    channelName: string
  ): void {
    try {
      const filePath = this.getFilePath(username, userId, guildName, channelName);
      this.ensureDir(filePath);
      
      const cleanPrompt = this.cleanNewlines(prompt);
      const timestamp = new Date().toISOString();
      
      fs.appendFileSync(filePath, `\n=== CODE GENERATION REQUEST ===\n`);
      fs.appendFileSync(filePath, `Timestamp: ${timestamp}\n`);
      fs.appendFileSync(filePath, `Job ID: ${jobId}\n`);
      fs.appendFileSync(filePath, `Project Type: ${projectType}\n`);
      fs.appendFileSync(filePath, `User Request: ${cleanPrompt}\n`);
      fs.appendFileSync(filePath, `Output Location: ${outputLocation}\n`);
      fs.appendFileSync(filePath, `Files Generated: ${filesGenerated.join(', ')}\n`);
      fs.appendFileSync(filePath, `================================\n\n`);
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
