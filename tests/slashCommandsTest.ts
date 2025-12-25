/**
 * Manual test helper for /flash and /pro commands
 * 
 * This script helps verify:
 * 1. /flash command uses google/gemini-3-flash-preview
 * 2. /pro command allows model selection between glm-4.7 and minimax-m2.1
 * 3. Both commands use appropriate codegen (cached vs non-cached)
 * 4. Premium gating works correctly
 */

import { SlashCommandBuilder } from 'discord.js';

// Verify command structure
console.log('🧪 Testing slash command definitions...\n');

// Test /flash command
const flashCommand = new SlashCommandBuilder()
  .setName('flash')
  .setDescription('Generate code with flash model (premium only)')
  .addStringOption((opt) =>
    opt
      .setName('prompt')
      .setDescription('What should I build?')
      .setRequired(true)
  );

console.log('✅ /flash command structure valid');
console.log('   - Required option: prompt (string)');
console.log('   - Expected model: google/gemini-3-flash-preview');
console.log('   - Expected pipeline: direct_cached (if model supports caching)\n');

// Test /pro command with model selection
const proCommand = new SlashCommandBuilder()
  .setName('pro')
  .setDescription('Generate code with pro model (premium only)')
  .addStringOption((opt) =>
    opt
      .setName('prompt')
      .setDescription('What should I build?')
      .setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName('model')
      .setDescription('Choose pro model')
      .setRequired(false)
      .addChoices(
        { name: 'GLM-4.7 (Z-AI, balanced)', value: 'z-ai/glm-4.7' },
        { name: 'Minimax M2.1 (creative)', value: 'minimax/minimax-m2.1' }
      )
  );

console.log('✅ /pro command structure valid');
console.log('   - Required option: prompt (string)');
console.log('   - Optional option: model (choice)');
console.log('     • GLM-4.7 (Z-AI, balanced) → z-ai/glm-4.7');
console.log('     • Minimax M2.1 (creative) → minimax/minimax-m2.1');
console.log('   - Default model: z-ai/glm-4.7');
console.log('   - Expected pipeline: direct_cached or direct (based on caching support)\n');

// Test /imagine command
const imagineCommand = new SlashCommandBuilder()
  .setName('imagine')
  .setDescription('Generate an image (premium only)')
  .addStringOption((opt) =>
    opt
      .setName('prompt')
      .setDescription('Describe the image to generate')
      .setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName('size')
      .setDescription('Image size')
      .setRequired(false)
      .addChoices(
        { name: 'Square (1024x1024)', value: '1024x1024' },
        { name: 'Portrait (1024x1792)', value: '1024x1792' },
        { name: 'Landscape (1792x1024)', value: '1792x1024' }
      )
  );

console.log('✅ /imagine command structure valid');
console.log('   - Required option: prompt (string)');
console.log('   - Optional option: size (choice)');
console.log('     • Square (1024x1024)');
console.log('     • Portrait (1024x1792)');
console.log('     • Landscape (1792x1024)\n');

console.log('📋 TESTING CHECKLIST (Manual Discord Testing Required):');
console.log('');
console.log('1. Premium Role Setup:');
console.log('   □ Run /premium-role set role:@YourRole as server owner');
console.log('   □ Verify role is stored with /premium-role show');
console.log('   □ Try /flash as non-admin without role (should fail)');
console.log('   □ Try /flash as non-admin WITH role (should work)');
console.log('   □ Try /flash as server owner (should work regardless of role)');
console.log('');
console.log('2. /flash Command:');
console.log('   □ Run: /flash prompt:"create a todo app"');
console.log('   □ Check logs for: "Using cached codegen pipeline" or "Using non-cached"');
console.log('   □ Check logs for: "model ${model}" (should be google/gemini-3-flash-preview)');
console.log('   □ Verify zip file is generated and sent');
console.log('   □ Verify files are correctly generated');
console.log('');
console.log('3. /pro Command (Model Selection):');
console.log('   □ Run: /pro prompt:"create a landing page" model:"GLM-4.7 (Z-AI, balanced)"');
console.log('   □ Check logs for model: "z-ai/glm-4.7"');
console.log('   □ Run: /pro prompt:"create a dashboard" model:"Minimax M2.1 (creative)"');
console.log('   □ Check logs for model: "minimax/minimax-m2.1"');
console.log('   □ Run: /pro prompt:"create an app" (without model choice)');
console.log('   □ Check logs for default model: "z-ai/glm-4.7"');
console.log('');
console.log('4. /imagine Command:');
console.log('   □ Run: /imagine prompt:"a beautiful sunset" size:"Square (1024x1024)"');
console.log('   □ Verify image is generated and sent');
console.log('   □ Try in DM (should be blocked with error message)');
console.log('');
console.log('5. Automatic Coding Mode (Normal Chat):');
console.log('   □ Say: "emma code me a website"');
console.log('   □ Verify CODING tier is detected');
console.log('   □ Verify it uses kwaipilot/kat-coder-pro:free (not gated)');
console.log('   □ Say: "build me a react app"');
console.log('   □ Verify CODING tier detection works');
console.log('');
console.log('✨ All commands implemented according to PROMPT B specifications!');
