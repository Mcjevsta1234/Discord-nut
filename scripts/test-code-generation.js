const readline = require('readline');
const { spawn } = require('child_process');

// Start the console app
const app = spawn('node', ['dist/index.js', '--console'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe']
});

// Wait for the prompt to appear
let promptReady = false;
const outputBuffer = [];

app.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(output);
  outputBuffer.push(output);
  
  if (output.includes('>') && !promptReady) {
    promptReady = true;
    // Send test message after a short delay
    setTimeout(() => {
      console.log('\n\n=== SENDING TEST MESSAGE ===\n');
      app.stdin.write('Emma code me a simple calculator app in react\n');
    }, 500);
  }
});

app.stderr.on('data', (data) => {
  console.error(`STDERR: ${data}`);
});

app.on('close', (code) => {
  console.log(`Process exited with code ${code}`);
  process.exit(code);
});

// Exit after 3 minutes
setTimeout(() => {
  console.log('\n\n=== TIMEOUT: Exiting ===\n');
  app.stdin.write('/exit\n');
}, 180000);
