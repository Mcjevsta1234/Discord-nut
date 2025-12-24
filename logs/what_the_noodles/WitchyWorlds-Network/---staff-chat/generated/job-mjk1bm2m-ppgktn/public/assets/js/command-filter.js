export class CommandFilter {
  constructor() {
    this.whitelist = [
      /^\s*\/spark\s+profiler\s*$/i,
      /^\s*\/spark\s+tps\s*$/i,
      /^\s*\/spark\s+healthreport\s+--memory\s*$/i,
      /^\s*\/list\s*$/i,
      /^\s*\/help\s*$/i
    ];
    this.blacklist = [
      /\/stop\b/i,
      /\/op\b/i,
      /\/start\b/i,
      /\/restart\b/i,
      /\/halt\b/i,
      /\/settime\b/i,
      /\/gamerule\b/i
    ];
  }

  isAllowed(command) {
    const lower = command.toLowerCase();
    for (const regex of this.blacklist) {
      if (regex.test(lower)) return false;
    }
    for (const regex of this.whitelist) {
      if (regex.test(command)) return true;
    }
    return false;
  }
}
