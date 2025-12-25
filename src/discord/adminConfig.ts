import fs from 'fs';
import path from 'path';
import { GuildMember, PermissionFlagsBits } from 'discord.js';
import { env } from '../config/env';

export interface GuildAdminConfig {
  roleId?: string; // If set, members with this role are admins
  permission?: keyof typeof PermissionFlagsBits; // If set, members with this permission are admins
  premiumRoleId?: string; // Premium role allowed to run gated commands
  updatedAt: number;
}

export class AdminConfigManager {
  private readonly baseDir = path.join(process.cwd(), 'settings', 'admin');
  private readonly adminUserIds: Set<string> = new Set(env.ADMIN_USER_IDS);

  constructor() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getConfigPath(guildId: string): string {
    return path.join(this.baseDir, `${guildId}.json`);
  }

  getConfig(guildId: string): GuildAdminConfig | null {
    try {
      const p = this.getConfigPath(guildId);
      if (!fs.existsSync(p)) return null;
      const raw = fs.readFileSync(p, 'utf-8');
      const data = JSON.parse(raw) as GuildAdminConfig;
      return data;
    } catch {
      return null;
    }
  }

  setRole(guildId: string, roleId: string): void {
    const cfg: GuildAdminConfig = {
      ...(this.getConfig(guildId) || {}),
      roleId,
      updatedAt: Date.now(),
    };
    fs.writeFileSync(this.getConfigPath(guildId), JSON.stringify(cfg, null, 2), 'utf-8');
  }

  setPermission(guildId: string, permission: keyof typeof PermissionFlagsBits): void {
    const cfg: GuildAdminConfig = {
      ...(this.getConfig(guildId) || {}),
      permission,
      updatedAt: Date.now(),
    };
    fs.writeFileSync(this.getConfigPath(guildId), JSON.stringify(cfg, null, 2), 'utf-8');
  }

  clear(guildId: string): void {
    const p = this.getConfigPath(guildId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  setPremiumRole(guildId: string, roleId: string): void {
    const cfg: GuildAdminConfig = {
      ...(this.getConfig(guildId) || {}),
      premiumRoleId: roleId,
      updatedAt: Date.now(),
    };
    fs.writeFileSync(this.getConfigPath(guildId), JSON.stringify(cfg, null, 2), 'utf-8');
  }

  clearPremiumRole(guildId: string): void {
    const cfg = this.getConfig(guildId);
    if (!cfg) return;
    delete cfg.premiumRoleId;
    cfg.updatedAt = Date.now();
    fs.writeFileSync(this.getConfigPath(guildId), JSON.stringify(cfg, null, 2), 'utf-8');
  }

  getPremiumRoleId(guildId: string): string | undefined {
    if (!guildId) return undefined;
    return this.getConfig(guildId)?.premiumRoleId;
  }

  isAdmin(guildId: string, member: GuildMember | null | undefined): boolean {
    if (!member) return false;

    // Owner override via ADMIN_USER_IDS
    if (this.adminUserIds.has(member.user.id)) {
      return true;
    }

    // Guild owner is always admin
    if ((member.guild as any)?.ownerId && (member.guild as any).ownerId === member.id) {
      return true;
    }

    const cfg = this.getConfig(guildId);

    // 1) Role-based admin
    if (cfg?.roleId) {
      return member.roles.cache.has(cfg.roleId);
    }

    // 2) Permission-based admin
    if (cfg?.permission && PermissionFlagsBits[cfg.permission]) {
      return !!member.permissions?.has(PermissionFlagsBits[cfg.permission]);
    }

    // 3) Default: ManageGuild
    return !!member.permissions?.has(PermissionFlagsBits.ManageGuild);
  }
}
