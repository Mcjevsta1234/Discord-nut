# File Attachments - Discord 8MB Limit Handling

## Overview

The bot can now create and send file attachments with intelligent handling of Discord's 8MB size limit.

## Features

### Automatic Size Management

- **≤ 1MB**: Attaches normally, no warnings
- **1-8MB**: Attaches with size warning
- **> 8MB**: Creates truncated preview with clear message

### Supported File Types

Common file types with syntax highlighting:

- Code: `.ts`, `.js`, `.jsx`, `.tsx`, `.py`, `.java`, `.cpp`, `.c`, `.rs`, `.go`, `.sh`
- Data: `.json`, `.yml`, `.yaml`, `.xml`, `.csv`
- Text: `.md`, `.txt`, `.patch`, `.diff`
- Web: `.html`, `.css`, `.sql`

### Smart Attachment Decisions

The bot automatically decides when to attach vs inline:

```typescript
// Attach if:
// - More than 200 lines
// - More than 2000 characters
FileAttachmentHandler.shouldAttach(content, lineThreshold)
```

## Usage

### Creating Attachments

```typescript
import { FileAttachmentHandler, FileContent } from '../discord/fileAttachments';

const file: FileContent = {
  filename: 'config.json',
  content: JSON.stringify(config, null, 2),
  contentType: 'application/json'
};

const result = FileAttachmentHandler.createAttachment(file);

if (result.attachment) {
  await message.reply({
    content: result.warning || 'Here\'s your file:',
    files: [result.attachment]
  });
}

if (result.error) {
  await message.reply(result.error);
}
```

### Multiple Files

```typescript
const files: FileContent[] = [
  { filename: 'index.ts', content: '...' },
  { filename: 'package.json', content: '...' }
];

const { attachments, warnings, errors } = 
  FileAttachmentHandler.createMultipleAttachments(files);

await message.reply({
  content: warnings.join('\n') || 'Files attached',
  files: attachments
});
```

### Large File Splitting

For files > 7MB, automatically split into parts:

```typescript
const parts = FileAttachmentHandler.splitLargeFile(
  largeContent,
  'script.js',
  7 * 1024 * 1024 // 7MB chunks
);

// Creates: script.part1.js, script.part2.js, script.part3.js
```

## API Reference

### `createAttachment(file: FileContent): AttachmentResult`

Creates a Discord attachment from file content.

**Parameters:**
- `file.filename`: File name with extension
- `file.content`: File content as string
- `file.contentType`: Optional MIME type

**Returns:**
```typescript
{
  attachment?: AttachmentBuilder,  // Discord attachment
  warning?: string,                // Size warning (1-8MB)
  error?: string,                  // Error message (>8MB)
  truncated?: boolean,             // If preview was created
  originalSize?: number            // Size in bytes
}
```

### `shouldAttach(content: string, lineThreshold?: number): boolean`

Determines if content should be attached vs inlined.

**Parameters:**
- `content`: File content
- `lineThreshold`: Max lines before attaching (default: 200)

**Returns:** `true` if should attach, `false` if should inline

### `createMultipleAttachments(files: FileContent[])`

Creates attachments for multiple files with total size checking.

**Returns:**
```typescript
{
  attachments: AttachmentBuilder[],
  warnings: string[],
  errors: string[]
}
```

### `splitLargeFile(content: string, filename: string, maxSize?: number): FileContent[]`

Splits large content into multiple files.

**Parameters:**
- `content`: File content
- `filename`: Original filename
- `maxSize`: Max size per file (default: 7MB)

**Returns:** Array of file parts with `.part1`, `.part2` suffixes

### `detectFileType(filename: string): string`

Detects file type from extension for syntax highlighting.

**Returns:** Language name for code blocks (e.g., `'typescript'`, `'json'`, `'markdown'`)

### `formatSize(bytes: number): string`

Formats byte size for display.

**Returns:** Human-readable size (e.g., `'1.5MB'`, `'523KB'`, `'42B'`)

## Size Handling Examples

### Example 1: Small File (< 1MB)

```typescript
const file = {
  filename: 'config.json',
  content: '{"key": "value"}'
};

const result = FileAttachmentHandler.createAttachment(file);
// result.attachment exists
// result.warning is undefined
```

Result: Attaches normally

### Example 2: Large File (1-8MB)

```typescript
const file = {
  filename: 'data.json',
  content: largeJsonString // 3MB
};

const result = FileAttachmentHandler.createAttachment(file);
// result.attachment exists
// result.warning: "⚠️ Large file: 3.00MB (Discord limit: 8MB)"
```

Result: Attaches with warning

### Example 3: Too Large (> 8MB)

```typescript
const file = {
  filename: 'huge.log',
  content: hugeLogString // 15MB
};

const result = FileAttachmentHandler.createAttachment(file);
// result.attachment exists (preview only)
// result.error: "File is too large for Discord (15.00MB > 8MB)"
// result.truncated: true
```

Result: Creates truncated preview:

```
============================================================
TRUNCATED PREVIEW: huge.log
Original: 50000 lines
Showing: 100 lines
Omitted: 49900 lines
============================================================

[first 100 lines]

============================================================
... 49900 more lines omitted ...
============================================================
```

## Integration with GitHub Tool

The GitHub tool can now return file attachments:

```typescript
// When file content is large
const fileContent = await githubTool.execute({
  repo: 'owner/repo',
  action: 'file',
  path: 'src/large-file.ts'
});

if (FileAttachmentHandler.shouldAttach(fileContent.data.file.content)) {
  const attachment = FileAttachmentHandler.createAttachment({
    filename: 'large-file.ts',
    content: fileContent.data.file.content
  });
  
  // Send as attachment instead of inlined
}
```

## Best Practices

### ✅ DO

- Check size before attaching
- Use meaningful filenames
- Add context in message text
- Handle errors gracefully
- Split very large files

### ❌ DON'T

- Silently truncate without warning
- Attach binary data as text
- Ignore Discord size limits
- Use generic filenames like "file.txt"
- Send multiple huge files at once

## Error Handling

### File Too Large

```typescript
if (result.error) {
  await message.reply(
    `${result.error}\n\nTry requesting a smaller file or specific sections.`
  );
}
```

### Total Size Too Large

```typescript
const { errors } = FileAttachmentHandler.createMultipleAttachments(files);

if (errors.length > 0) {
  await message.reply(
    `Cannot attach all files:\n${errors.join('\n')}\n\nSending files individually...`
  );
  // Send one at a time
}
```

### Network Upload Failures

```typescript
try {
  await message.reply({ files: [attachment] });
} catch (error) {
  if (error.message.includes('Request entity too large')) {
    await message.reply('File upload failed - Discord rejected the size.');
  }
}
```

## Configuration

### Default Limits

```typescript
const DISCORD_MAX_SIZE = 8 * 1024 * 1024;  // 8MB
const SAFE_SIZE = 1 * 1024 * 1024;         // 1MB (no warning)
const PREVIEW_MAX_LINES = 100;              // Preview line limit
```

### Customizing Thresholds

```typescript
// Custom line threshold
const shouldAttach = FileAttachmentHandler.shouldAttach(content, 500); // 500 lines

// Custom split size
const parts = FileAttachmentHandler.splitLargeFile(
  content,
  'file.txt',
  5 * 1024 * 1024  // 5MB chunks
);
```

## Implementation

**File:** `src/discord/fileAttachments.ts`

**Key Classes:**
- `FileAttachmentHandler`: Main utility class
- `FileContent`: Input interface
- `AttachmentResult`: Output interface

**Dependencies:**
- `discord.js`: For `AttachmentBuilder`
- No external dependencies

## Future Enhancements

Potential improvements:

- [ ] Compression for text files (gzip)
- [ ] External file hosting for >8MB
- [ ] Automatic image resizing
- [ ] PDF generation for formatted content
- [ ] Archive creation (.zip) for multiple files
