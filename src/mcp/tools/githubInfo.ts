/**
 * GitHub Info Tool
 * Read-only GitHub repository information using GitHub REST API (no auth required for public repos)
 * Returns Discord-friendly repository details
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
}

export class GitHubInfoTool implements MCPTool {
  definition: MCPToolDefinition = {
    name: 'github_info',
    description: 'Get read-only information about a GitHub repository (stars, forks, issues, latest activity). Use for queries about GitHub repos.',
    parameters: [
      {
        name: 'repo',
        type: 'string',
        description: 'GitHub repository in format "owner/repo" (e.g., "facebook/react")',
        required: true,
      },
    ],
  };

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const repo = params.repo as string;

      if (!repo || !repo.includes('/')) {
        return {
          success: false,
          error: 'Repository must be in format "owner/repo" (e.g., "facebook/react")',
        };
      }

      const repoInfo = await this.fetchRepoInfo(repo);

      if (!repoInfo) {
        return {
          success: false,
          error: `Repository "${repo}" not found or is not accessible`,
        };
      }

      // Format for Discord display
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
        error: error instanceof Error ? error.message : 'Unknown error fetching GitHub info',
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
            'User-Agent': 'Discord-nut-bot/1.0',
            'Accept': 'application/vnd.github+json',
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error(`Error fetching GitHub repo ${repo}:`, error);
      return null;
    }
  }
}
