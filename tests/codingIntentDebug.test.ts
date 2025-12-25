const testMessages = [
  "please build me a full landing page for my startup",
  "code me this html website",
  "create a react app",
  "make me a discord bot",
  "build a website for my business",
  "help me code this",
  "what's the weather",
  "search for react tutorials",
];

const intentPatterns = [
  // Flexible patterns that allow words between verb and target
  /(build|create|make|code|write|develop|design)\s+.{0,50}(website|web\s*app|web\s*site|app|application|program|script|bot|discord\s*bot|api|backend|frontend|ui|landing\s*page|homepage|portfolio|dashboard)/,
  /(scaffold|generate|spin\s*up|draft|setup|set\s*up)\s+.{0,30}(react|next\.?js|vue|angular|node|express|fastapi|flask|django|discord)/,
  /(help|assist|guide)\s+me\s+(code|build|develop|create)/,
  /(turn|convert|translate).{0,20}(spec|design|mockup).{0,20}(code|app|website)/,
  // Direct requests
  /^(code|program|develop)\s+(me\s+)?(a\s+)?/,
  // HTML/CSS/JS specific
  /(html|css|javascript|typescript|react|vue)\s+(website|page|app|site)/,
];

testMessages.forEach(testMessage => {
  const normalized = testMessage.toLowerCase();
  const hasIntent = intentPatterns.some((pattern) => pattern.test(normalized));
  console.log(`${hasIntent ? '✅' : '❌'} "${testMessage}"`);
});

