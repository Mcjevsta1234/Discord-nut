/**
 * Deterministic GitHub Repository Tool
 * Uses GitHub REST API directly - no MCP, no hallucinations
 * All data comes from actual API responses, no fabricated information
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';
import axios, { AxiosError } from 'axios';

interface GitHubRepoMeta {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics: string[];
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  size: number;
  open_issues_count: number;
  license: { name: string; spdx_id: string } | null;
}

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  size?: number;
  sha: string;
}

interface GitHubCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      date: string;
    };
    message: string;
  };
  html_url: string;
}

export class GitHubRepoTool implements MCPTool {
  definition: MCPToolDefinition = {
    name: 'github_repo',
    description:
      'Deterministic GitHub repository access. Actions: "summary" (README + package.json + tree), "readme" (README only), "file" (specific file), "tree" (list files), "commits" (recent commits). Always use actual fetched data, never fabricate.',
    parameters: [
      {
        name: 'repo',
        type: 'string',
        description:
          'Repository as "owner/repo" or GitHub URL (e.g., "microsoft/vscode" or "https://github.com/microsoft/vscode")',
        required: true,
      },
      {
        name: 'action',
        type: 'string',
        description: 'Action: "summary", "readme", "file", "tree", "commits". Default: "summary"',
        required: false,
      },
      {
        name: 'path',
        type: 'string',
        description: 'File path (for "file" action) or directory path (for "tree" action)',
        required: false,
      },
      {
        name: 'ref',
        type: 'string',
        description: 'Branch/tag/commit ref (default: default branch)',
        required: false,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Number of commits to fetch (for "commits" action, default: 10)',
        required: false,
      },
    ],
  };

  private readonly API_BASE = 'https://api.github.com';
  private readonly TIMEOUT_MS = 10000;
  private readonly MAX_RETRIES = 1;

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const repoInput = params.repo as string;
      const action = (params.action as string)?.toLowerCase() || 'summary';
      const path = params.path as string;
      const ref = params.ref as string;
      const limit = (params.limit as number) || 10;

      // Parse repo from various input formats
      const parsed = this.parseRepoInput(repoInput);
      if (!parsed) {
        return {
          success: false,
          error: 'Invalid repository format. Use "owner/repo" or GitHub URL',
        };
      }

      const { owner, repo, filePath, fileRef } = parsed;

      // Use path from URL if available, otherwise from params
      const finalPath = filePath || path;
      const finalRef = fileRef || ref;

      switch (action) {
        case 'summary':
          return await this.getSummary(owner, repo, finalRef);
        case 'readme':
          return await this.getReadmeOnly(owner, repo, finalRef);
        case 'file':
          if (!finalPath) {
            return {
              success: false,
              error: 'File path required for "file" action',
            };
          }
          return await this.getFile(owner, repo, finalPath, finalRef);
        case 'tree':
          return await this.getTree(owner, repo, finalPath, finalRef);
        case 'commits':
          return await this.getCommits(owner, repo, limit);
        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Use: summary, readme, file, tree, commits`,
          };
      }
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Parse repository input from various formats:
   * - owner/repo
   * - https://github.com/owner/repo
   * - https://github.com/owner/repo/blob/branch/path/to/file.ts
   */
  private parseRepoInput(input: string): {
    owner: string;
    repo: string;
    filePath?: string;
    fileRef?: string;
  } | null {
    // Clean up input
    input = input.trim();

    // Handle GitHub URLs
    if (input.includes('github.com')) {
      // Match: https://github.com/owner/repo/blob/branch/path/to/file
      const blobMatch = input.match(
        /github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/
      );
      if (blobMatch) {
        return {
          owner: blobMatch[1],
          repo: blobMatch[2].replace(/\.git$/, ''),
          fileRef: blobMatch[3],
          filePath: blobMatch[4],
        };
      }

      // Match: https://github.com/owner/repo
      const repoMatch = input.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
      if (repoMatch) {
        return {
          owner: repoMatch[1],
          repo: repoMatch[2].replace(/\.git$/, ''),
        };
      }
    }

    // Handle owner/repo format
    const match = input.match(/^([^\/]+)\/([^\/]+)$/);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, ''),
      };
    }

    return null;
  }

  /**
   * Get repository metadata
   */
  private async getRepoMeta(owner: string, repo: string): Promise<GitHubRepoMeta> {
    const url = `${this.API_BASE}/repos/${owner}/${repo}`;
    const response = await this.makeRequest<GitHubRepoMeta>(url);
    return response;
  }

  /**
   * Get README content
   */
  private async getReadme(
    owner: string,
    repo: string,
    ref?: string
  ): Promise<{ path: string; content: string } | null> {
    const url = `${this.API_BASE}/repos/${owner}/${repo}/readme${ref ? `?ref=${ref}` : ''}`;
    
    try {
      const response = await this.makeRequest<{
        name: string;
        path: string;
        content: string;
        encoding: string;
      }>(url);

      if (response.encoding === 'base64') {
        const content = Buffer.from(response.content, 'base64').toString('utf-8');
        return {
          path: response.path,
          content,
        };
      }

      return {
        path: response.path,
        content: response.content,
      };
    } catch (error) {
      // README not found is expected for some repos
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get file content
   */
  private async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<{ path: string; content: string; size: number } | null> {
    const url = `${this.API_BASE}/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${ref}` : ''}`;
    
    try {
      const response = await this.makeRequest<{
        name: string;
        path: string;
        content?: string;
        encoding?: string;
        size: number;
        type: string;
      }>(url);

      if (response.type === 'dir') {
        return null;
      }

      if (response.encoding === 'base64' && response.content) {
        const content = Buffer.from(response.content, 'base64').toString('utf-8');
        return {
          path: response.path,
          content,
          size: response.size,
        };
      }

      return {
        path: response.path,
        content: response.content || '',
        size: response.size,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get repository tree (file listing)
   */
  private async getRepoTree(
    owner: string,
    repo: string,
    ref?: string
  ): Promise<GitHubTreeItem[]> {
    // First, get the default branch if no ref specified
    if (!ref) {
      const meta = await this.getRepoMeta(owner, repo);
      ref = meta.default_branch;
    }

    // Get the tree recursively
    const url = `${this.API_BASE}/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`;
    
    try {
      const response = await this.makeRequest<{
        sha: string;
        tree: GitHubTreeItem[];
        truncated: boolean;
      }>(url);

      return response.tree;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get recent commits
   */
  private async getRecentCommits(
    owner: string,
    repo: string,
    perPage: number = 10
  ): Promise<GitHubCommit[]> {
    const url = `${this.API_BASE}/repos/${owner}/${repo}/commits?per_page=${perPage}`;
    const response = await this.makeRequest<GitHubCommit[]>(url);
    return response;
  }

  /**
   * Action: Get comprehensive summary (README + package.json + tree)
   */
  private async getSummary(
    owner: string,
    repo: string,
    ref?: string
  ): Promise<MCPToolResult> {
    try {
      // Fetch in parallel
      const [meta, readme, tree] = await Promise.all([
        this.getRepoMeta(owner, repo),
        this.getReadme(owner, repo, ref),
        this.getRepoTree(owner, repo, ref).catch(() => null),
      ]);

      // Try to get package.json if it exists
      let packageJson: any = null;
      try {
        const pkgFile = await this.getFileContent(owner, repo, 'package.json', ref);
        if (pkgFile) {
          packageJson = JSON.parse(pkgFile.content);
        }
      } catch (e) {
        // package.json not found or invalid - that's fine
      }

      // Build output - ONLY with fetched data
      const output: any = {
        repo: `${owner}/${repo}`,
        ref: ref || meta.default_branch,
        meta: {
          description: meta.description || 'No description provided',
          stars: meta.stargazers_count,
          forks: meta.forks_count,
          language: meta.language || 'Unknown',
          topics: meta.topics,
          license: meta.license?.name || 'No license',
          created: meta.created_at,
          updated: meta.updated_at,
          url: meta.html_url,
        },
      };

      if (readme) {
        output.readme = {
          path: readme.path,
          content: readme.content,
        };
      } else {
        output.readme = {
          message: 'No README found in this repository',
        };
      }

      if (packageJson) {
        output.packageJson = {
          name: packageJson.name,
          version: packageJson.version,
          description: packageJson.description,
          dependencies: packageJson.dependencies
            ? Object.keys(packageJson.dependencies).length
            : 0,
          scripts: packageJson.scripts ? Object.keys(packageJson.scripts) : [],
        };
      }

      if (tree && tree.length > 0) {
        // Show top-level structure
        const topLevel = tree
          .filter((item) => !item.path.includes('/'))
          .map((item) => ({
            path: item.path,
            type: item.type,
            size: item.size,
          }));
        
        output.tree = {
          totalFiles: tree.filter((item) => item.type === 'blob').length,
          totalDirs: tree.filter((item) => item.type === 'tree').length,
          topLevel,
        };
      }

      return {
        success: true,
        data: output,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Action: Get README only
   */
  private async getReadmeOnly(
    owner: string,
    repo: string,
    ref?: string
  ): Promise<MCPToolResult> {
    try {
      const [meta, readme] = await Promise.all([
        this.getRepoMeta(owner, repo),
        this.getReadme(owner, repo, ref),
      ]);

      if (!readme) {
        return {
          success: true,
          data: {
            repo: `${owner}/${repo}`,
            message: 'No README found in this repository',
            meta: {
              description: meta.description || 'No description provided',
              url: meta.html_url,
            },
          },
        };
      }

      return {
        success: true,
        data: {
          repo: `${owner}/${repo}`,
          ref: ref || meta.default_branch,
          readme: {
            path: readme.path,
            content: readme.content,
          },
          meta: {
            description: meta.description || 'No description provided',
            stars: meta.stargazers_count,
            language: meta.language || 'Unknown',
            url: meta.html_url,
          },
        },
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Action: Get specific file
   */
  private async getFile(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<MCPToolResult> {
    try {
      const file = await this.getFileContent(owner, repo, path, ref);

      if (!file) {
        return {
          success: false,
          error: `File not found: ${path}`,
        };
      }

      return {
        success: true,
        data: {
          repo: `${owner}/${repo}`,
          ref: ref || 'default branch',
          file: {
            path: file.path,
            content: file.content,
            size: file.size,
          },
        },
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Action: Get tree/directory listing
   */
  private async getTree(
    owner: string,
    repo: string,
    path?: string,
    ref?: string
  ): Promise<MCPToolResult> {
    try {
      const tree = await this.getRepoTree(owner, repo, ref);

      let filtered = tree;
      if (path) {
        // Filter to specific directory
        const prefix = path.endsWith('/') ? path : `${path}/`;
        filtered = tree.filter((item) => item.path.startsWith(prefix));
      }

      const files = filtered
        .filter((item) => item.type === 'blob')
        .map((item) => ({
          path: item.path,
          size: item.size,
        }));

      const dirs = filtered
        .filter((item) => item.type === 'tree')
        .map((item) => item.path);

      return {
        success: true,
        data: {
          repo: `${owner}/${repo}`,
          ref: ref || 'default branch',
          path: path || '/',
          tree: {
            files,
            directories: dirs,
            totalFiles: files.length,
            totalDirectories: dirs.length,
          },
        },
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Action: Get recent commits
   */
  private async getCommits(
    owner: string,
    repo: string,
    limit: number
  ): Promise<MCPToolResult> {
    try {
      const commits = await this.getRecentCommits(owner, repo, limit);

      const formatted = commits.map((commit) => ({
        sha: commit.sha.substring(0, 7),
        author: commit.commit.author.name,
        date: commit.commit.author.date,
        message: commit.commit.message.split('\n')[0], // First line only
        url: commit.html_url,
      }));

      return {
        success: true,
        data: {
          repo: `${owner}/${repo}`,
          commits: formatted,
          count: formatted.length,
        },
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Make HTTP request with timeout and retry
   */
  private async makeRequest<T>(url: string, retryCount = 0): Promise<T> {
    try {
      const response = await axios.get<T>(url, {
        timeout: this.TIMEOUT_MS,
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Discord-Nut-Bot',
        },
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        // Retry on network errors
        if (
          retryCount < this.MAX_RETRIES &&
          (!error.response || error.response.status >= 500)
        ) {
          console.log(`Retrying GitHub request (attempt ${retryCount + 1})`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return this.makeRequest<T>(url, retryCount + 1);
        }
      }
      throw error;
    }
  }

  /**
   * Handle errors consistently
   */
  private handleError(error: unknown): MCPToolResult {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.response?.status === 404) {
        return {
          success: false,
          error: 'Repository or resource not found',
        };
      }
      
      if (axiosError.response?.status === 403) {
        const rateLimitReset = axiosError.response.headers['x-ratelimit-reset'];
        const resetTime = rateLimitReset
          ? new Date(parseInt(rateLimitReset) * 1000).toLocaleTimeString()
          : 'unknown';
        
        return {
          success: false,
          error: `GitHub API rate limit exceeded. Resets at ${resetTime}. Consider adding GITHUB_TOKEN to environment.`,
        };
      }

      return {
        success: false,
        error: `GitHub API error: ${axiosError.message}`,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
