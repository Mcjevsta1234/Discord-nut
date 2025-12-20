/**
 * GitHub Repository Tool
 * Uses official GitHub MCP server for repository access
 * Supports: file reading, directory listing, search, and more via MCP protocol
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

export class GitHubInfoTool implements MCPTool {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private initPromise: Promise<void> | null = null;

  definition: MCPToolDefinition = {
    name: 'github_repo',
    description: 'GitHub repository access via MCP. Can: read files (README, code), list directories, search repos, get repo info. Supports "owner/repo" format. For summaries, use action="readme".',
    parameters: [
      {
        name: 'repo',
        type: 'string',
        description: 'Repository as "owner/repo" (e.g., "microsoft/vscode")',
        required: true,
      },
      {
        name: 'action',
        type: 'string',
        description: 'Action: "info", "readme", "file", "tree", "search". Default: "readme"',
        required: false,
      },
      {
        name: 'path',
        type: 'string',
        description: 'File or directory path (for "file" and "tree" actions)',
        required: false,
      },
      {
        name: 'query',
        type: 'string',
        description: 'Search query (for "search" action)',
        required: false,
      },
    ],
  };

  private async ensureConnected(): Promise<void> {
    if (this.client) return;

    if (!this.initPromise) {
      this.initPromise = this.initializeClient();
    }

    await this.initPromise;
  }

  private async initializeClient(): Promise<void> {
    try {
      // Initialize GitHub MCP server connection
      this.transport = new StdioClientTransport({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          ...process.env,
          // GitHub token optional - works without for public repos
          GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || '',
        },
      });

      this.client = new Client(
        {
          name: 'discord-nut-github-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      await this.client.connect(this.transport);
      console.log('✓ Connected to GitHub MCP server');
    } catch (error) {
      console.error('Failed to connect to GitHub MCP server:', error);
      this.client = null;
      this.transport = null;
      throw error;
    }
  }

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      await this.ensureConnected();

      if (!this.client) {
        return {
          success: false,
          error: 'GitHub MCP client not initialized',
        };
      }

      const repoInput = params.repo as string;
      const action = (params.action as string)?.toLowerCase() || 'readme';
      const path = params.path as string;
      const query = params.query as string;

      // Parse repo from URL or owner/repo format
      const repo = this.parseRepo(repoInput);

      if (!repo) {
        return {
          success: false,
          error: 'Invalid repository format. Use "owner/repo" (e.g., "microsoft/vscode")',
        };
      }

      switch (action) {
        case 'info':
          return await this.getRepoInfo(repo);
        case 'readme':
          return await this.getReadme(repo);
        case 'file':
          return await this.getFile(repo, path);
        case 'tree':
          return await this.getTree(repo, path);
        case 'search':
          return await this.searchRepo(repo, query);
        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Use: info, readme, file, tree, search`,
          };
      }
    } catch (error) {
      console.error('GitHub MCP error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error accessing GitHub',
      };
    }
  }

  private parseRepo(input: string): string | null {
    // Handle GitHub URLs
    if (input.includes('github.com')) {
      const match = input.match(/github\.com\/([^\/]+\/[^\/\?#]+)/);
      if (match) {
        return match[1].replace(/\.git$/, '');
      }
    }
    // Handle owner/repo format
    if (input.match(/^[^\/]+\/[^\/]+$/)) {
      return input;
    }
    return null;
  }

  private async getRepoInfo(repo: string): Promise<MCPToolResult> {
    try {
      // Use MCP get_file_contents to read repository metadata
      const result = await this.client!.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_file_contents',
            arguments: {
              owner: repo.split('/')[0],
              repo: repo.split('/')[1],
              path: 'README.md',
            },
          },
        },
        z.any()
      );

      // Return basic info with README preview
      return {
        success: true,
        data: {
          repo,
          message: `Repository: ${repo}\nUse action="readme" to fetch full README.md`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error fetching repo info',
      };
    }
  }

  private async getReadme(repo: string): Promise<MCPToolResult> {
    try {
      const [owner, repoName] = repo.split('/');

      // Call MCP get_file_contents tool
      const result = await this.client!.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_file_contents',
            arguments: {
              owner,
              repo: repoName,
              path: 'README.md',
            },
          },
        },
        z.any()
      );

      // Extract content from MCP response
      if (result && typeof result === 'object' && 'content' in result) {
        const content = (result as any).content;
        
        // Parse MCP content array
        let readmeText = '';
        if (Array.isArray(content)) {
          readmeText = content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text)
            .join('\n');
        } else if (typeof content === 'string') {
          readmeText = content;
        }

        return {
          success: true,
          data: {
            repo,
            readme: readmeText,
            name: repo,
          },
        };
      }

      return {
        success: false,
        error: 'README.md not found or empty',
      };
    } catch (error) {
      console.error('Error fetching README:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error fetching README',
      };
    }
  }

  private async getFile(repo: string, path: string): Promise<MCPToolResult> {
    try {
      if (!path) {
        return {
          success: false,
          error: 'File path is required',
        };
      }

      const [owner, repoName] = repo.split('/');

      const result = await this.client!.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_file_contents',
            arguments: {
              owner,
              repo: repoName,
              path,
            },
          },
        },
        z.any()
      );

      if (result && typeof result === 'object' && 'content' in result) {
        const content = (result as any).content;
        
        let fileText = '';
        if (Array.isArray(content)) {
          fileText = content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text)
            .join('\n');
        } else if (typeof content === 'string') {
          fileText = content;
        }

        // Truncate if too long
        const MAX_LENGTH = 2000;
        if (fileText.length > MAX_LENGTH) {
          fileText = fileText.substring(0, MAX_LENGTH) + '\n\n...(truncated)';
        }

        return {
          success: true,
          data: {
            repo,
            path,
            content: fileText,
          },
        };
      }

      return {
        success: false,
        error: `File "${path}" not found`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error fetching file',
      };
    }
  }

  private async getTree(repo: string, path?: string): Promise<MCPToolResult> {
    try {
      const [owner, repoName] = repo.split('/');

      // Use search_repositories to get directory structure
      const result = await this.client!.request(
        {
          method: 'tools/call',
          params: {
            name: 'search_repositories',
            arguments: {
              query: `repo:${repo}`,
            },
          },
        },
        z.any()
      );

      return {
        success: true,
        data: {
          repo,
          message: 'Use GitHub web interface to browse repository structure. MCP provides file reading, not directory listing.',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error fetching tree',
      };
    }
  }

  private async searchRepo(repo: string, query: string): Promise<MCPToolResult> {
    try {
      if (!query) {
        return {
          success: false,
          error: 'Search query is required',
        };
      }

      const result = await this.client!.request(
        {
          method: 'tools/call',
          params: {
            name: 'search_code',
            arguments: {
              query: `${query} repo:${repo}`,
            },
          },
        },
        z.any()
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error searching repository',
      };
    }
  }

  async cleanup(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
      if (this.transport) {
        await this.transport.close();
        this.transport = null;
      }
    } catch (error) {
      console.error('Error cleaning up GitHub MCP client:', error);
    }
  }
}

