# GitHub Integration - Deterministic & No Hallucinations

## Overview

The GitHub integration uses the **GitHub REST API directly** - no MCP, no fabricated information. All data comes from actual API responses.

## Features

### Deterministic Data Fetching

- **No hallucinations**: Summaries only use retrieved content
- **Explicit missing data**: States "No README found" instead of guessing
- **Real API data**: Stars, forks, language, topics all from GitHub API
- **Rate limit handling**: Graceful errors with reset time

### Tool Interface

Tool name: `github_repo`

#### Actions

1. **summary** (default)
   - Fetches: README + package.json + top-level tree
   - Returns: Repo metadata, README content, package info, file structure
   - Usage: `"summarize https://github.com/owner/repo"`

2. **readme**
   - Fetches: README only
   - Returns: README content + basic metadata
   - Usage: `"read README from owner/repo"`

3. **file**
   - Fetches: Specific file content
   - Returns: File content, size, path
   - Usage: `"read file src/index.ts from owner/repo"`

4. **tree**
   - Fetches: Repository file/directory listing
   - Returns: Files and directories (with filtering)
   - Usage: `"list files in owner/repo"`

5. **commits**
   - Fetches: Recent commit history
   - Returns: SHA, author, date, message, URL
   - Usage: `"show recent commits in owner/repo"`

### Input Formats

All of these work:

- `owner/repo` (e.g., `microsoft/vscode`)
- `https://github.com/owner/repo`
- `https://github.com/owner/repo/blob/main/src/file.ts` (extracts file path)

### Parameters

```typescript
{
  repo: string,          // Required: "owner/repo" or GitHub URL
  action?: string,       // Optional: "summary" | "readme" | "file" | "tree" | "commits"
  path?: string,         // Optional: File/directory path (for file/tree actions)
  ref?: string,          // Optional: Branch/tag/commit (default: default branch)
  limit?: number         // Optional: Number of commits (default: 10)
}
```

### Example Requests

**Summarize a repository:**
```
emma summarize https://github.com/Mcjevsta1234/Discord-nut
```

**Read a specific file:**
```
wiz read file src/config.ts from Mcjevsta1234/Discord-nut
```

**List repository structure:**
```
steve list files in microsoft/vscode
```

**Get recent commits:**
```
emma show last 5 commits in owner/repo
```

### Output Structure

#### Summary Action
```json
{
  "repo": "owner/repo",
  "ref": "main",
  "meta": {
    "description": "...",
    "stars": 123,
    "forks": 45,
    "language": "TypeScript",
    "topics": ["discord", "bot"],
    "license": "MIT",
    "created": "2024-01-01T00:00:00Z",
    "updated": "2024-12-20T00:00:00Z",
    "url": "https://github.com/owner/repo"
  },
  "readme": {
    "path": "README.md",
    "content": "..."
  },
  "packageJson": {
    "name": "package-name",
    "version": "1.0.0",
    "dependencies": 15,
    "scripts": ["build", "test", "start"]
  },
  "tree": {
    "totalFiles": 42,
    "totalDirs": 12,
    "topLevel": [
      {"path": "README.md", "type": "blob", "size": 1234},
      {"path": "src", "type": "tree"}
    ]
  }
}
```

#### README Action
```json
{
  "repo": "owner/repo",
  "ref": "main",
  "readme": {
    "path": "README.md",
    "content": "# Project Title\n..."
  },
  "meta": {
    "description": "...",
    "stars": 123,
    "language": "TypeScript",
    "url": "https://github.com/owner/repo"
  }
}
```

#### File Action
```json
{
  "repo": "owner/repo",
  "ref": "main",
  "file": {
    "path": "src/index.ts",
    "content": "import ...",
    "size": 2048
  }
}
```

#### Tree Action
```json
{
  "repo": "owner/repo",
  "ref": "main",
  "path": "/",
  "tree": {
    "files": [
      {"path": "README.md", "size": 1234},
      {"path": "src/index.ts", "size": 2048}
    ],
    "directories": ["src", "docs"],
    "totalFiles": 42,
    "totalDirectories": 12
  }
}
```

#### Commits Action
```json
{
  "repo": "owner/repo",
  "commits": [
    {
      "sha": "abc1234",
      "author": "John Doe",
      "date": "2024-12-20T12:00:00Z",
      "message": "Fix bug in feature X",
      "url": "https://github.com/owner/repo/commit/abc1234..."
    }
  ],
  "count": 10
}
```

### Error Handling

#### Rate Limit
```json
{
  "success": false,
  "error": "GitHub API rate limit exceeded. Resets at 3:45 PM. Consider adding GITHUB_TOKEN to environment."
}
```

#### Not Found
```json
{
  "success": false,
  "error": "Repository or resource not found"
}
```

#### Network Error
```json
{
  "success": false,
  "error": "GitHub API error: timeout"
}
```

### Reliability Features

- **Timeout**: 10 seconds per request
- **Retry**: 1 automatic retry on 5xx errors
- **Rate limits**: Graceful handling with reset time
- **No auth required**: Works for public repos without token
- **Optional auth**: Set `GITHUB_TOKEN` for higher rate limits

### Anti-Hallucination Enforcement

1. **Only use fetched data**: Summaries only include API responses
2. **Explicit missing data**: "No README found" vs guessing purpose
3. **No inference**: If data missing, state it explicitly
4. **Type safety**: All responses follow strict TypeScript interfaces
5. **Validation**: Check for null/undefined before using data

### Configuration

#### Optional: Add GitHub Token for Higher Rate Limits

Create a `.env` file:
```bash
GITHUB_TOKEN=ghp_your_personal_access_token_here
```

**Without token**: 60 requests/hour
**With token**: 5000 requests/hour

### Implementation Details

- **File**: `src/mcp/tools/githubRepo.ts`
- **REST API**: Direct axios calls to `https://api.github.com`
- **No dependencies**: Removed `@modelcontextprotocol/sdk` MCP dependency
- **Type-safe**: All responses typed with TypeScript interfaces
- **Error-safe**: Comprehensive error handling with fallbacks

### Migration from Old GitHub MCP Tool

The old `GitHubInfoTool` (MCP-based) has been completely removed and replaced with `GitHubRepoTool` (REST-based).

**Changes:**
- ❌ Removed: MCP SDK dependency for GitHub
- ❌ Removed: `src/mcp/tools/githubInfo.ts`
- ✅ Added: `src/mcp/tools/githubRepo.ts` (deterministic REST)
- ✅ Same tool name: `github_repo` (no bot changes needed)
- ✅ Enhanced: Better error handling and rate limit management

**Behavior improvements:**
- No more hallucinated repository information
- Explicit "No README found" messages
- Real-time rate limit feedback
- Support for file path extraction from URLs
