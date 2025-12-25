#!/usr/bin/env node

/**
 * Quick verification that model pools system is working
 * Run: node tools/models/verify.js
 */

const fs = require('fs');
const path = require('path');

const checks = [
  {
    name: 'OpenRouter models cache exists',
    file: '.cache/openrouter-models.json',
    validate: (data) => {
      const parsed = JSON.parse(data);
      return parsed.models && parsed.models.length > 0 && parsed.fetchedAt;
    }
  },
  {
    name: 'Model pools output exists',
    file: '.cache/model-pools.json',
    validate: (data) => {
      const parsed = JSON.parse(data);
      return parsed.chosenDefaults && parsed.tiers && parsed.models;
    }
  },
  {
    name: 'Tiers are populated',
    file: '.cache/model-pools.json',
    validate: (data) => {
      const parsed = JSON.parse(data);
      return parsed.tiers.every(t => t.models.length > 0);
    }
  },
  {
    name: 'Chosen defaults are valid OpenRouter IDs',
    file: '.cache/model-pools.json',
    validate: (data) => {
      const parsed = JSON.parse(data);
      const { bulkModel, pageModel, smallTasksModel } = parsed.chosenDefaults;
      return bulkModel.includes('/') && pageModel.includes('/') && smallTasksModel.includes('/');
    }
  }
];

console.log('=== Model Pools System Verification ===\n');

let passed = 0;
let failed = 0;

for (const check of checks) {
  try {
    const filePath = path.join(__dirname, '../..', check.file);
    
    if (!fs.existsSync(filePath)) {
      console.log(`✗ ${check.name}: File not found`);
      failed++;
      continue;
    }
    
    const data = fs.readFileSync(filePath, 'utf-8');
    
    if (check.validate(data)) {
      console.log(`✓ ${check.name}`);
      passed++;
    } else {
      console.log(`✗ ${check.name}: Validation failed`);
      failed++;
    }
  } catch (error) {
    console.log(`✗ ${check.name}: ${error.message}`);
    failed++;
  }
}

console.log(`\n${passed}/${checks.length} checks passed`);

if (failed > 0) {
  console.log('\nTo fix, run:');
  console.log('  npm run models:sync');
  console.log('  npm run models:rank');
  process.exit(1);
}

console.log('\n✓ Model pools system is working correctly!');
