/**
 * File Attachment Utility
 * Handles safe file creation and Discord 8MB attachment limits
 */

import { AttachmentBuilder } from 'discord.js';

export interface FileContent {
  filename: string;
  content: string;
  contentType?: string;
}

export interface AttachmentResult {
  attachment?: AttachmentBuilder;
  warning?: string;
  error?: string;
  truncated?: boolean;
  originalSize?: number;
}

export class FileAttachmentHandler {
  // Discord attachment limits
  private static readonly DISCORD_MAX_SIZE = 8 * 1024 * 1024; // 8MB
  private static readonly SAFE_SIZE = 1 * 1024 * 1024; // 1MB - no warning
  private static readonly PREVIEW_MAX_LINES = 100; // For truncated previews

  /**
   * Create a Discord attachment from file content
   * Handles size limits and provides warnings/previews
   */
  static createAttachment(file: FileContent): AttachmentResult {
    const buffer = Buffer.from(file.content, 'utf-8');
    const sizeBytes = buffer.length;

    // Check if within Discord limits
    if (sizeBytes > this.DISCORD_MAX_SIZE) {
      // Too large - provide truncated preview
      const preview = this.createTruncatedPreview(file.content, file.filename);
      const previewBuffer = Buffer.from(preview, 'utf-8');

      return {
        attachment: new AttachmentBuilder(previewBuffer, {
          name: `${file.filename}.preview.txt`,
        }),
        error: `File is too large for Discord (${this.formatSize(sizeBytes)} > 8MB)`,
        truncated: true,
        originalSize: sizeBytes,
      };
    }

    // Within limits - create attachment
    const attachment = new AttachmentBuilder(buffer, {
      name: file.filename,
    });

    // Add warning if between 1MB and 8MB
    if (sizeBytes > this.SAFE_SIZE) {
      return {
        attachment,
        warning: `⚠️ Large file: ${this.formatSize(sizeBytes)} (Discord limit: 8MB)`,
      };
    }

    return {
      attachment,
    };
  }

  /**
   * Check if content should be attached vs inlined
   * Returns true if content is large enough to warrant attachment
   */
  static shouldAttach(content: string, lineThreshold: number = 200): boolean {
    const lines = content.split('\n').length;
    const chars = content.length;

    // Attach if:
    // - More than threshold lines
    // - More than 2000 characters (Discord message limit considerations)
    return lines > lineThreshold || chars > 2000;
  }

  /**
   * Create multiple attachments from array of files
   * Returns attachments and any warnings/errors
   */
  static createMultipleAttachments(files: FileContent[]): {
    attachments: AttachmentBuilder[];
    warnings: string[];
    errors: string[];
  } {
    const attachments: AttachmentBuilder[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    let totalSize = 0;

    for (const file of files) {
      const result = this.createAttachment(file);

      if (result.attachment) {
        attachments.push(result.attachment);
        totalSize += result.originalSize || 0;
      }

      if (result.warning) {
        warnings.push(`${file.filename}: ${result.warning}`);
      }

      if (result.error) {
        errors.push(`${file.filename}: ${result.error}`);
      }
    }

    // Check total size
    if (totalSize > this.DISCORD_MAX_SIZE) {
      errors.push(
        `Total size exceeds Discord limit: ${this.formatSize(totalSize)} > 8MB`
      );
    }

    return { attachments, warnings, errors };
  }

  /**
   * Create a truncated preview of large content
   */
  private static createTruncatedPreview(content: string, filename: string): string {
    const lines = content.split('\n');
    const totalLines = lines.length;

    if (totalLines <= this.PREVIEW_MAX_LINES) {
      return content;
    }

    const previewLines = lines.slice(0, this.PREVIEW_MAX_LINES);
    const truncatedCount = totalLines - this.PREVIEW_MAX_LINES;

    return `${'='.repeat(60)}
TRUNCATED PREVIEW: ${filename}
Original: ${totalLines} lines
Showing: ${this.PREVIEW_MAX_LINES} lines
Omitted: ${truncatedCount} lines
${'='.repeat(60)}

${previewLines.join('\n')}

${'='.repeat(60)}
... ${truncatedCount} more lines omitted ...
${'='.repeat(60)}
`;
  }

  /**
   * Format byte size for display
   */
  private static formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  /**
   * Detect file type from filename
   */
  static detectFileType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    
    const typeMap: Record<string, string> = {
      ts: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      tsx: 'typescript',
      json: 'json',
      md: 'markdown',
      txt: 'text',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      rs: 'rust',
      go: 'go',
      sh: 'shell',
      bash: 'shell',
      yml: 'yaml',
      yaml: 'yaml',
      xml: 'xml',
      html: 'html',
      css: 'css',
      sql: 'sql',
      patch: 'diff',
      diff: 'diff',
    };

    return typeMap[ext || ''] || 'text';
  }

  /**
   * Split large content into multiple files if needed
   */
  static splitLargeFile(
    content: string,
    filename: string,
    maxSize: number = 7 * 1024 * 1024 // 7MB per file
  ): FileContent[] {
    const buffer = Buffer.from(content, 'utf-8');
    
    if (buffer.length <= maxSize) {
      return [{ filename, content }];
    }

    // Split by lines to avoid breaking mid-line
    const lines = content.split('\n');
    const files: FileContent[] = [];
    let currentChunk: string[] = [];
    let currentSize = 0;
    let partNumber = 1;

    for (const line of lines) {
      const lineSize = Buffer.byteLength(line + '\n', 'utf-8');

      if (currentSize + lineSize > maxSize && currentChunk.length > 0) {
        // Save current chunk
        const ext = filename.includes('.') ? filename.split('.').pop() : 'txt';
        const base = filename.replace(/\.[^.]+$/, '');
        files.push({
          filename: `${base}.part${partNumber}.${ext}`,
          content: currentChunk.join('\n'),
        });
        
        currentChunk = [];
        currentSize = 0;
        partNumber++;
      }

      currentChunk.push(line);
      currentSize += lineSize;
    }

    // Save remaining chunk
    if (currentChunk.length > 0) {
      const ext = filename.includes('.') ? filename.split('.').pop() : 'txt';
      const base = filename.replace(/\.[^.]+$/, '');
      files.push({
        filename: `${base}.part${partNumber}.${ext}`,
        content: currentChunk.join('\n'),
      });
    }

    return files;
  }
}
