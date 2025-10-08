#!/usr/bin/env node

const { execSync } = require('child_process');

// Workers to delete (16-30 from the original 30-worker deployment)
const workersToDelete = [
  'slc-scraper-pi',
  'slc-scraper-rho', 
  'slc-scraper-sigma',
  'slc-scraper-tau',
  'slc-scraper-upsilon',
  'slc-scraper-phi',
  'slc-scraper-chi',
  'slc-scraper-psi',
  'slc-scraper-omega',
  'slc-scraper-apex',
  'slc-scraper-nexus',
  'slc-scraper-vertex',
  'slc-scraper-matrix',
  'slc-scraper-cortex',
  'slc-scraper-vortex'
];

console.log('🧹 Cleaning up extra workers to scale down from 30 to 15...');
console.log(`🎯 Deleting ${workersToDelete.length} workers`);

let deletedCount = 0;
let failedCount = 0;

for (const workerName of workersToDelete) {
  try {
    console.log(`🗑️  Deleting ${workerName}...`);
    execSync(`wrangler delete ${workerName}`, { stdio: 'pipe' });
    console.log(`✅ Deleted ${workerName}`);
    deletedCount++;
  } catch (error) {
    console.log(`❌ Failed to delete ${workerName}: ${error.message}`);
    failedCount++;
  }
}

console.log(`\n📊 Cleanup Summary:`);
console.log(`✅ Successfully deleted: ${deletedCount} workers`);
console.log(`❌ Failed to delete: ${failedCount} workers`);
console.log(`🎯 Remaining active workers: 15 (alpha through omicron)`);