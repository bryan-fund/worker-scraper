#!/usr/bin/env node

/**
 * Cleanup Old Cloudflare Workers
 * Removes all previously deployed workers to clean up the account
 */

const { execSync } = require('child_process');

// List of known old worker names to delete
const OLD_WORKERS = [
  'salt-lake-scraper',
  'salt-lake-scraper-prod', 
  'salt-lake-scraper-dev',
  'salt-lake-scraper-1',
  'salt-lake-scraper-2',
  'salt-lake-scraper-3',
  'salt-lake-scraper-4',
  'salt-lake-scraper-5',
  'salt-lake-scraper-6',
  'salt-lake-scraper-7',
  'salt-lake-scraper-8',
  'salt-lake-scraper-9',
  'salt-lake-scraper-10'
];

async function cleanupOldWorkers() {
  console.log('🧹 Cleaning up old Cloudflare Workers...');
  console.log(`📋 Workers to check: ${OLD_WORKERS.length}`);
  
  let deleted = 0;
  let notFound = 0;
  let errors = 0;
  
  for (const workerName of OLD_WORKERS) {
    console.log(`\n🔍 Checking worker: ${workerName}`);
    
    try {
      // Try to delete the worker
      const deleteCommand = `npx wrangler delete --name "${workerName}" --force`;
      const output = execSync(deleteCommand, { 
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      console.log(`✅ Deleted: ${workerName}`);
      deleted++;
      
    } catch (error) {
      const errorMessage = error.stderr || error.message || '';
      
      if (errorMessage.includes('not found') || errorMessage.includes('does not exist')) {
        console.log(`ℹ️  Not found: ${workerName} (already deleted or never existed)`);
        notFound++;
      } else {
        console.log(`❌ Error deleting ${workerName}: ${errorMessage.trim()}`);
        errors++;
      }
    }
    
    // Small delay to avoid rate limits
    await sleep(500);
  }
  
  console.log('\n📊 CLEANUP SUMMARY');
  console.log('==================');
  console.log(`✅ Deleted: ${deleted}`);
  console.log(`ℹ️  Not Found: ${notFound}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`📋 Total Checked: ${OLD_WORKERS.length}`);
  
  if (deleted > 0) {
    console.log('\n🎉 Old workers successfully cleaned up!');
  }
  
  if (errors > 0) {
    console.log('\n⚠️  Some workers could not be deleted. Check the errors above.');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run cleanup
if (require.main === module) {
  cleanupOldWorkers()
    .then(() => {
      console.log('\n🏁 Cleanup completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Cleanup failed:', error);
      process.exit(1);
    });
}

module.exports = { cleanupOldWorkers };