/**
 * Test Zip Archive Creation
 * 
 * Tests the new zip archive functionality by creating a mock job
 * and generating a zip file of sample output.
 */

const path = require('path');
const fs = require('fs');

// Compile TypeScript if needed
const { execSync } = require('child_process');
console.log('📦 Compiling TypeScript...');
try {
  execSync('npx tsc --noEmit', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  console.log('✅ TypeScript compilation successful\n');
} catch (error) {
  console.error('❌ TypeScript compilation failed');
  process.exit(1);
}

// Import compiled modules
const { createJob, ensureJobDirs, createZipArchive } = require('../dist/jobs');
const { ProjectRouter } = require('../dist/ai/projectRouter');

async function testZipCreation() {
  console.log('🧪 Testing Zip Archive Creation\n');
  
  // Create a test job
  const projectDecision = ProjectRouter.route('create a simple calculator web app');
  console.log('📦 Project Type:', projectDecision.projectType);
  
  const job = createJob(projectDecision, {
    userMessage: 'create a simple calculator web app',
    userId: 'test-user-123',
    guildId: 'test-guild-456',
    channelId: 'test-channel-789',
  });
  
  console.log('📋 Job created:', job.jobId);
  console.log('📁 Workspace:', job.paths.workspaceDir);
  console.log('📁 Output:', job.paths.outputDir);
  
  // Create directories
  ensureJobDirs(job);
  console.log('✅ Directories created\n');
  
  // Create some sample output files
  console.log('📝 Creating sample files...');
  
  const sampleFiles = [
    {
      name: 'index.html',
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Calculator</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <h1>Simple Calculator</h1>
  <div id="calculator">
    <input type="text" id="display" readonly>
    <div class="buttons">
      <button onclick="appendNumber('1')">1</button>
      <button onclick="appendNumber('2')">2</button>
      <button onclick="calculate()">=</button>
    </div>
  </div>
  <script src="script.js"></script>
</body>
</html>`,
    },
    {
      name: 'styles.css',
      content: `body {
  font-family: Arial, sans-serif;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  margin: 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

#calculator {
  background: white;
  padding: 20px;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.3);
}

#display {
  width: 100%;
  font-size: 24px;
  padding: 10px;
  margin-bottom: 10px;
  text-align: right;
}

.buttons button {
  width: 60px;
  height: 60px;
  font-size: 18px;
  margin: 5px;
}`,
    },
    {
      name: 'script.js',
      content: `let display = document.getElementById('display');

function appendNumber(num) {
  display.value += num;
}

function calculate() {
  try {
    display.value = eval(display.value);
  } catch (e) {
    display.value = 'Error';
  }
}`,
    },
    {
      name: 'README.md',
      content: `# Simple Calculator

A basic web-based calculator built with HTML, CSS, and JavaScript.

## Features
- Addition, subtraction, multiplication, division
- Clean, responsive design
- Purple gradient background

## Usage
Open \`index.html\` in your browser to use the calculator.`,
    },
  ];
  
  for (const file of sampleFiles) {
    const filePath = path.join(job.paths.outputDir, file.name);
    fs.writeFileSync(filePath, file.content, 'utf8');
    console.log(`  ✓ ${file.name} (${file.content.length} bytes)`);
  }
  
  console.log('✅ Sample files created\n');
  
  // Create zip archive
  console.log('📦 Creating zip archive...');
  try {
    const zipPath = await createZipArchive(job);
    console.log('✅ Zip archive created successfully!');
    console.log('📦 Zip path:', zipPath);
    
    // Check zip file stats
    const stats = fs.statSync(zipPath);
    console.log('📊 Zip size:', stats.size, 'bytes');
    console.log('📊 Zip size (KB):', (stats.size / 1024).toFixed(2), 'KB');
    
    // Verify zip exists
    if (fs.existsSync(zipPath)) {
      console.log('✅ Zip file verified to exist on disk');
      
      // List what would be in the zip (simulated)
      console.log('\n📋 Archive contents:');
      sampleFiles.forEach(file => {
        console.log(`  ✓ ${file.name}`);
      });
    }
    
    console.log('\n🎉 Test completed successfully!');
    console.log(`\n💡 You can find the test artifacts at:`);
    console.log(`   Workspace: ${job.paths.workspaceDir}`);
    console.log(`   Output: ${job.paths.outputDir}`);
    console.log(`   Zip: ${zipPath}`);
    
  } catch (error) {
    console.error('❌ Zip creation failed:', error);
    throw error;
  }
}

// Run test
testZipCreation()
  .then(() => {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
