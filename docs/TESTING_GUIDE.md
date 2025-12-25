# Quick Test Guide - Coding Requests

## ✅ Fixed - These Should Now Work

### Basic Coding Requests
```
code me this html website
build me a landing page
create a react app
make me a discord bot
build a website for my business
help me code this feature
develop an api backend
```

### Detailed Requests
```
please build me a full landing page for my startup
create a modern react website with a hero section
code me a discord bot that responds to commands
make an express api with user authentication
develop a portfolio website with animations
```

### What You Should See

1. **In Bot Logs:**
   ```
   🎯 Routing message from [user]...
   🚩 Flags detected:
      • containsCode: true
   🤖 HEURISTIC ROUTING:
      ✅ Rule 2 matched: Code/coding request detected
      📊 Heuristic decision: CODING (95% confidence)
   🧪 CODING tier detected - routing to project handler
   📦 Project Type: static_html / node_project / discord_bot
   📋 Job created: job-xxxxx
   💻 Generating code...
   ```

2. **In Discord:**
   - Progress message with animated spinner
   - Updates: "Planning... → Generating code... → Packaging files..."
   - Final response with:
     - Project summary
     - File count
     - Download link (zip attachment)
     - Quick start instructions

## ❌ Should NOT Trigger Coding

### Regular Searches
```
search for react tutorials
what is the weather today
tell me about programming
find information on JavaScript
```

These should trigger SMART tier with searxng_search tool.

### Greetings
```
hey how are you
hello emma
good morning
```

These should trigger INSTANT tier (fast greeting response).

## Premium Commands (Require Premium Role)

### /imagine
```
/imagine prompt: a beautiful sunset over mountains
```
- Generates image using ImageService
- Only works in servers (not DMs)
- Requires premium role or server owner

### /flash (Free Fast Coding)
```
/flash prompt: create a landing page for my startup
```
- Uses google/gemini-3-flash-preview model
- Fast code generation
- Requires premium role or server owner

### /pro (Premium Coding)
```
/pro prompt: build a complex react dashboard
```
- Uses z-ai/glm-4.7 model (or configured PRO model)
- Higher quality code generation
- Requires premium role or server owner

## Admin Commands (Require Manage Guild or Admin)

### /premium-role
```
/premium-role set role: @Premium
/premium-role show
/premium-role clear
```

## Testing Checklist

- [ ] Basic coding request: "code me a website"
- [ ] Detailed coding request: "build me a landing page for my startup"
- [ ] Non-coding request: "search for react tutorials"
- [ ] Greeting: "hey how are you"
- [ ] Premium command (as owner): `/flash prompt: create a website`
- [ ] Premium command (as owner): `/imagine prompt: sunset`
- [ ] Check logs for CODING tier detection
- [ ] Verify zip file is generated and attached
- [ ] Test /premium-role set/show/clear

## Monitoring Commands

```bash
# Watch logs in real-time
npm start

# Check recent logs
cat logs/[username]/[guild]/[channel]/generated/job-*/job-*.log

# Run routing tests
npx tsx tests/routingComprehensive.test.ts
```

## Troubleshooting

### Issue: Still getting searxng_search
**Check:**
1. Did you rebuild? `npm run build`
2. Did you restart the bot? `npm start`
3. Check logs for "CODING tier detected"

### Issue: No zip file attached
**Check:**
1. Job logs in `logs/[username]/[guild]/[channel]/generated/job-*/`
2. Look for "Zip created:" in logs
3. Check for codegen errors

### Issue: Commands not showing
**Check:**
1. Bot is running: `npm start`
2. "Slash commands registered" appears in logs
3. Wait 1-5 minutes for Discord to propagate commands
4. Try in different server or re-invite bot
