// Test script for ProjectRouter
const { ProjectRouter } = require('./dist/ai/projectRouter');

console.log('=== Testing ProjectRouter ===\n');

// Test cases
const testCases = [
  "create a landing page for my startup",
  "build a discord bot with slash commands",
  "make an API server with Express",
  "create a React website with Next.js",
  "build a discord.js bot that responds to messages",
  "make a Node.js CLI tool"
];

testCases.forEach((testCase, i) => {
  console.log(`\n--- Test ${i + 1} ---`);
  console.log(`Input: "${testCase}"`);
  
  const result = ProjectRouter.route(testCase);
  
  console.log(`Project Type: ${result.projectType}`);
  console.log(`Preview Allowed: ${result.previewAllowed}`);
  console.log(`Requires Build: ${result.requiresBuild}`);
  console.log(`Description: ${result.description}`);
  console.log(`Matched Keywords: ${result.matchedKeywords.join(', ')}`);
});

console.log('\n\n=== Running Internal Tests ===\n');
ProjectRouter.test();

console.log('\n✅ All tests completed!');
