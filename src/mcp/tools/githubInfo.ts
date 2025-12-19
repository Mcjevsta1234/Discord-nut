/**
 * GitHub Repository Tool
 * Deep read-only access to GitHub repositories
 * Supports: repo info, file reading, tree listing, commits, tech stack detection
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';
import axios from 'axios';

interface GitHubRepoInfo {
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  language: string | null;
  html_url: string;
  pushed_at: string;
  topics?: string[];
  license?: { name: string } | null;
}

interface GitHubFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  download_url?: string;
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
}

export class GitHubInfoTool implements MCPTool {
  definition: MCPToolDefinition = {
    name: 'github_repo',
    description: 'Deep read-only GitHub repository access. Can: summarize repos, read files (README, package.json, etc), list structure, detect tech stack, show recent commits. Supports "owner/repo" or full URLs.',
    parameters: [
      {
        name: 'repo',
        type: 'string',
        description: 'Repository as "owner/repo" or full GitHub URL',
        required: true,
      },
      {
        name: 'action',
        type: 'string',
        description: 'Action: "info" (default), "summary", "readme", "file", "tree", "commits", "package", "config"',
        required: false,
      },
      {
        name: 'path',
        type: 'string',
        description: 'File path (for "file" action) or directory path (for "tree" action)',
        required: false,
      },
    ],
  };

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const repoInput = params.repo as string;
      const action = (params.action as string)?.toLowerCase() || 'info';
      const path = params.path as string;

      // Parse repo from URL or owner/repo format
      const repo = this.parseRepo(repoInput);

      if (!repo) {
        return {
          success: false,
          error: 'Invalid repository format. Use "owner/repo" or a GitHub URL',
        };
      }

      switch (action) {
        case 'info':
          return await this.getRepoInfo(repo);
        case 'summary':
          return await this.getRepoSummary(repo);
        case 'readme':
          return await this.getReadme(repo);
        case 'file':
          return await this.getFile(repo, path);
        case 'tree':
          return await this.getTree(repo, path);
        case 'commits':
          return await this.getRecentCommits(repo);
        case 'package':
          return await this.getFile(repo, 'package.json');
        case 'config':
          return await this.detectConfigs(repo);
        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Use: info, summary, readme, file, tree, commits, package, config`,
          };
      }
    } catch (error) {
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
      const repoInfo = await this.fetchRepoInfo(repo);

      if (!repoInfo) {
        return {
          success: false,
          error: `Repository "${repo}" not found or is not accessible`,
        };
      }

      const lines: string[] = [
        `**GitHub Repository: ${repoInfo.full_name}**`,
        '',
      ];

      if (repoInfo.description) {
        lines.push(`📝 ${repoInfo.description}`);
        lines.push('');
      }

      lines.push(`⭐ **${repoInfo.stargazers_count.toLocaleString()}** stars`);
      lines.push(`🍴 **${repoInfo.forks_count.toLocaleString()}** forks`);
      lines.push(`🐛 **${repoInfo.open_issues_count.toLocaleString()}** open issues`);

      if (repoInfo.language) {
        lines.push(`💻 Primary language: **${repoInfo.language}**`);
      }

      if (repoInfo.license) {
        lines.push(`📄 License: **${repoInfo.license.name}**`);
      }

      if (repoInfo.topics && repoInfo.topics.length > 0) {
        lines.push(`🏷️ Topics: ${repoInfo.topics.map(t => `\`${t}\``).join(', ')}`);
      }

      const lastPush = new Date(repoInfo.pushed_at);
      const unixTime = Math.floor(lastPush.getTime() / 1000);
      lines.push(`🕐 Last updated: <t:${unixTime}:R>`);
      lines.push('');
      lines.push(`🔗 ${repoInfo.html_url}`);

      return {
        success: true,
        data: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error fetching repo info',
      };
    }
  }

  private async getRepoSummary(repo: string): Promise<MCPToolResult> {
    try {
      const [repoInfo, readme, packageJson] = await Promise.allSettled([
        this.fetchRepoInfo(repo),
        this.fetchFile(repo, 'README.md'),
        this.fetchFile(repo, 'package.json'),
      ]);

      if (repoInfo.status === 'rejected') {
        return {
          success: false,
          error: `Repository "${repo}" not found`,
        };
      }

      const info = repoInfo.value;
      const lines: string[] = [
        `**${info?.full_name}**`,
        '',
      ];

      if (info?.description) {
        lines.push(info.description);
        lines.push('');
      }

      // Tech stack detection
      const techStack: string[] = [];
      if (info?.language) techStack.push(info.language);
      
      if (packageJson.status === 'fulfilled' && packageJson.value) {
        try {
          const pkg = JSON.parse(packageJson.value);
          if (pkg.dependencies) {
            if (pkg.dependencies.react) techStack.push('React');
            if (pkg.dependencies.vue) techStack.push('Vue');
            if (pkg.dependencies.angular) techStack.push('Angular');
            if (pkg.dependencies.next) techStack.push('Next.js');
            if (pkg.dependencies.express) techStack.push('Express');
            if (pkg.dependencies.typescript) techStack.push('TypeScript');
          }
        } catch {}
      }

      if (techStack.length > 0) {
        lines.push(`**Tech Stack:** ${techStack.join(', ')}`);
        lines.push('');
      }

      lines.push(`⭐ ${info?.stargazers_count.toLocaleString()} stars • 🍴 ${info?.forks_count.toLocaleString()} forks`);

      if (readme.status === 'fulfilled' && readme.value) {
        // Extract first few lines of README (skip title)
        const readmeLines = readme.value.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 3);
        if (readmeLines.length > 0) {
          lines.push('');
          lines.push('**From README:**');
          lines.push(readmeLines.join('\n').substring(0, 300) + (readmeLines.join('\n').length > 300 ? '...' : ''));
        }
      }

      return {
        success: true,
        data: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error generating summary',
      };
    }
  }

  private async getReadme(repo: string): Promise<MCPToolResult> {
    try {
      const content = await this.fetchFile(repo, 'README.md');
      
      if (!content) {
        return {
          success: false,
          error: 'README.md not found',
        };
      }

      // Truncate if too long for Discord
      const truncated = content.length > 1800 
        ? content.substring(0, 1800) + '\n\n...(truncated)'
        : content;

      return {
        success: true,
        data: `**README.md**\n\n${truncated}`,
      };
    } catch (error) {
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

      const content = await this.fetchFile(repo, path);
      
      if (!content) {
        return {
          success: false,
          error: `File "${path}" not found`,
        };
      }

      // Truncate if too long
      const truncated = content.length > 1800 
        ? content.substring(0, 1800) + '\n\n...(truncated)'
        : content;

      return {
        success: true,
        data: `**${path}**\n\`\`\`\n${truncated}\n\`\`\``,
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
      const files = await this.fetchTree(repo, path || '');
      
      if (!files || files.length === 0) {
        return {
          success: false,
          error: path ? `Directory "${path}" not found or empty` : 'Repository is empty',
        };
      }

      const dirs = files.filter(f => f.type === 'dir').map(f => `📁 ${f.name}`);
      const fileList = files.filter(f => f.type === 'file').map(f => `📄 ${f.name}`);

      const lines: string[] = [
        `**Repository Structure${path ? `: ${path}` : ''}**`,
        '',
        ...dirs,
        ...fileList,
      ];

      // Truncate if too many items
      if (lines.length > 50) {
        return {
          success: true,
          data: lines.slice(0, 50).join('\n') + `\n\n...(${files.length - 48} more items)`,
        };
      }

      return {
        success: true,
        data: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error fetching tree',
      };
    }
  }

  private async getRecentCommits(repo: string): Promise<MCPToolResult> {
    try {
      const commits = await this.fetchCommits(repo, 5);
      
      if (!commits || commits.length === 0) {
        return {
          success: false,
          error: 'No commits found',
        };
      }

      const lines: string[] = ['**Recent Commits**', ''];

      for (const commit of commits) {
        const date = new Date(commit.commit.author.date);
        const unixTime = Math.floor(date.getTime() / 1000);
        const shortSha = commit.sha.substring(0, 7);
        const message = commit.commit.message.split('\n')[0]; // First line only
        
        lines.push(`\`${shortSha}\` ${message}`);
        lines.push(`  by ${commit.commit.author.name} • <t:${unixTime}:R>`);
        lines.push('');
      }

      return {
        success: true,
        data: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error fetching commits',
      };
    }
  }

  private async detectConfigs(repo: string): Promise<MCPToolResult> {
    try {
      const configFiles = [
        'package.json',
        'tsconfig.json',
        'docker-compose.yml',
        'Dockerfile',
        '.env.example',
        'config.json',
        'vite.config.ts',
        'next.config.js',
      ];

      const results = await Promise.allSettled(
        configFiles.map(file => this.fetchFile(repo, file))
      );

      const found: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          found.push(configFiles[index]);
        }
      });

      if (found.length === 0) {
        return {
          success: true,
          data: 'No common configuration files found',
        };
      }

      return {
        success: true,
        data: `**Configuration Files Found:**\n${found.map(f => `• \`${f}\``).join('\n')}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error detecting configs',
      };
    }
  }

  private async fetchRepoInfo(repo: string): Promise<GitHubRepoInfo | null> {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${repo}`,
        {
          timeout: 10000,
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Discord-Bot',
          },
        }
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  private async fetchFile(repo: string, path: string): Promise<string | null> {
    try {
      const response = await axios.get(
        `https://raw.githubusercontent.com/${repo}/HEAD/${path}`,
        {
          timeout: 10000,
          headers: {
            'User-Agent': 'Discord-Bot',
          },
        }
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  private async fetchTree(repo: string, path: string): Promise<GitHubFile[] | null> {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${repo}/contents/${path}`,
        {
          timeout: 10000,
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Discord-Bot',
          },
        }
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  private async fetchCommits(repo: string, count: number): Promise<GitHubCommit[] | null> {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${repo}/commits`,
        {
          params: { per_page: count },
          timeout: 10000,
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Discord-Bot',
          },
        }
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }
}

