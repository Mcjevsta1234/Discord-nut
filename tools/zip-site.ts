import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

// Get latest test directory or accept CLI argument
function getLatestTestDir(): string {
  const testsDir = path.join(__dirname, '../test-output');
  if (!fs.existsSync(testsDir)) {
    throw new Error('test-output directory not found');
  }
  
  const existing = fs.readdirSync(testsDir).filter(d => d.startsWith('test-'));
  const numbers = existing.map(d => parseInt(d.split('-')[1])).filter(n => !isNaN(n));
  if (numbers.length === 0) {
    throw new Error('No test directories found');
  }
  
  const latestNum = Math.max(...numbers);
  return path.join(testsDir, `test-${latestNum}`);
}

// Allow CLI override: npm run site:zip -- test-5
const cliArg = process.argv[2];
const DIST_DIR = cliArg 
  ? path.join(__dirname, '../test-output', cliArg)
  : getLatestTestDir();

function getZipPath(): string {
  // Save zip in same directory with directory name
  const dirName = path.basename(DIST_DIR);
  return path.join(DIST_DIR, `${dirName}.zip`);
}

async function zipDirectory(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(DIST_DIR)) {
      reject(new Error(`Directory not found: ${DIST_DIR}. Run site:gen first.`));
      return;
    }

    const ZIP_PATH = getZipPath();
    const zipName = path.basename(ZIP_PATH);

    // Remove existing zip if present
    if (fs.existsSync(ZIP_PATH)) {
      fs.unlinkSync(ZIP_PATH);
    }

    const output = fs.createWriteStream(ZIP_PATH);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const sizeKB = (archive.pointer() / 1024).toFixed(2);
      console.log(`✓ Created ${zipName} (${sizeKB} KB)`);
      console.log(`  Location: ${ZIP_PATH}`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Add all files except zip files and certain directories
    const files = fs.readdirSync(DIST_DIR);
    for (const file of files) {
      if (file.endsWith('.zip')) continue;
      
      const filepath = path.join(DIST_DIR, file);
      const stat = fs.statSync(filepath);
      
      if (stat.isFile()) {
        archive.file(filepath, { name: file });
      } else if (stat.isDirectory()) {
        archive.directory(filepath, file);
      }
    }

    archive.finalize();
  });
}

async function main() {
  console.log('=== Zipping Site ===\n');
  console.log(`Source: ${DIST_DIR}\n`);
  
  await zipDirectory();
  
  console.log('\n✓ Site packaged successfully');
}

main().catch(error => {
  console.error('Zip failed:', error);
  process.exit(1);
});
