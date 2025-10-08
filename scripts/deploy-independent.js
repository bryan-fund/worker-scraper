#!/usr/bin/env node

/**
 * Deploy Independent Cloudflare Workers for Salt Lake County Scraping
 * Enhanced version with maximum worker independence and anti-detection
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKER_COUNT = 20;

// Optional override so you can generate worker configs that point to a local
// collector (or a tunnel) without changing repository files. Set either
// COLLECTOR_BASE_OVERRIDE or LOCAL_COLLECTOR_URL_OVERRIDE in the environment
// before running this script.
const COLLECTOR_OVERRIDE = process.env.COLLECTOR_BASE_OVERRIDE || process.env.LOCAL_COLLECTOR_URL_OVERRIDE || '';

// Independent worker configurations with unique characteristics
const workerConfigs = [
  { name: 'slc-scraper-alpha', delay: 3, browserType: 'chrome' },
  { name: 'slc-scraper-beta', delay: 5, browserType: 'firefox' },
  { name: 'slc-scraper-gamma', delay: 4, browserType: 'safari' },
  { name: 'slc-scraper-delta', delay: 6, browserType: 'edge' },
  { name: 'slc-scraper-epsilon', delay: 2, browserType: 'opera' },
  { name: 'slc-scraper-zeta', delay: 7, browserType: 'chrome' },
  { name: 'slc-scraper-eta', delay: 4, browserType: 'firefox' },
  { name: 'slc-scraper-theta', delay: 5, browserType: 'safari' },
  { name: 'slc-scraper-iota', delay: 3, browserType: 'edge' },
  { name: 'slc-scraper-kappa', delay: 6, browserType: 'opera' },
  { name: 'slc-scraper-lambda', delay: 4, browserType: 'chrome' },
  { name: 'slc-scraper-mu', delay: 3, browserType: 'firefox' },
  { name: 'slc-scraper-nu', delay: 5, browserType: 'safari' },
  { name: 'slc-scraper-xi', delay: 4, browserType: 'edge' },
  { name: 'slc-scraper-omicron', delay: 6, browserType: 'opera' },
  { name: 'slc-scraper-pi', delay: 2, browserType: 'chrome' },
  { name: 'slc-scraper-rho', delay: 7, browserType: 'firefox' },
  { name: 'slc-scraper-sigma', delay: 3, browserType: 'safari' },
  { name: 'slc-scraper-tau', delay: 5, browserType: 'edge' },
  { name: 'slc-scraper-upsilon', delay: 4, browserType: 'opera' }
];

async function deployIndependentWorkers() {
  console.log('🚀 Deploying Independent Salt Lake County Scrapers...');
  console.log(`📊 Total Workers: ${WORKER_COUNT}`);
  console.log('🔒 Enhanced Features: Browser Fingerprinting, IP Rotation, Anti-Detection');
  
  const deployedWorkers = [];
  
  for (let i = 0; i < WORKER_COUNT; i++) {
    const config = workerConfigs[i];
    const workerNumber = i + 1;
    
    console.log(`\n🔧 Deploying Worker ${workerNumber}/${WORKER_COUNT}: ${config.name}`);
    console.log(`   Browser Type: ${config.browserType.toUpperCase()}`);
    console.log(`   Base Delay: ${config.delay}ms`);
    
    try {
      // Create independent wrangler.toml for this worker
  const wranglerConfig = `
name = "${config.name}"
main = "src/worker-independent.js"
compatibility_date = "2024-09-23"

[vars]
WORKER_ID = "${config.name}"
RATE_LIMIT_MS = "200"
BATCH_SIZE = "10"
CONTINUOUS = "1"
LOCAL_COLLECTOR_URL = "${COLLECTOR_OVERRIDE || 'https://sync.super-symmetry.ai/collect'}"
COLLECTOR_BASE = "${COLLECTOR_OVERRIDE || 'https://sync.super-symmetry.ai'}"
COLLECTOR_TOKEN = "${process.env.COLLECTOR_TOKEN || 'your-secure-token-here'}"
CF_ACCESS_CLIENT_ID = "${process.env.CF_ACCESS_CLIENT_ID || 'd092e29f5dc5589182f88b1089e145bf.access'}"
CF_ACCESS_CLIENT_SECRET = "${process.env.CF_ACCESS_CLIENT_SECRET || 'd4c67425d040f9edc90185c47e3169310981cd15d4401637d87adb68bba5a741'}"
COLLECTOR_ALLOW_CF_ACCESS = "${process.env.COLLECTOR_ALLOW_CF_ACCESS || '1'}"
BROWSER_TYPE = "${config.browserType}"
BASE_DELAY = "${config.delay}"

# Worker-specific settings for independence
[limits]
cpu_ms = 30000
memory_mb = 128
`;
      
      const configPath = path.join(__dirname, '../wrangler-' + config.name + '.toml');
      fs.writeFileSync(configPath, wranglerConfig.trim());
      
      // Deploy this specific worker
      const deployCommand = 'cd "' + path.dirname(__dirname) + '" && npx wrangler deploy --config wrangler-' + config.name + '.toml';
      const deployOutput = execSync(deployCommand, { encoding: 'utf8' });
      
      // Extract the actual worker URL from deployment output
      const urlMatch = deployOutput.match(/https:\/\/[^\s]+\.workers\.dev/);
      const workerUrl = urlMatch ? urlMatch[0] : 'https://' + config.name + '.w2ntsrpc5v.workers.dev';
      
      deployedWorkers.push({
        id: config.name,
        number: workerNumber,
        url: workerUrl,
        browserType: config.browserType,
        delay: config.delay,
        status: 'deployed'
      });
      
      console.log(`✅ Worker ${workerNumber} deployed successfully!`);
      console.log(`   URL: ${workerUrl}`);
      
      // Small delay between deployments to avoid rate limits
      if (i < WORKER_COUNT - 1) {
        await sleep(2000);
      }
      
    } catch (error) {
      console.error(`❌ Failed to deploy worker ${workerNumber}:`, error.message);
      deployedWorkers.push({
        id: config.name,
        number: workerNumber,
        status: 'failed',
        error: error.message
      });
    }
  }
  
  // Save deployment info
  const deploymentInfo = {
    timestamp: new Date().toISOString(),
    version: '2.0-independent',
    totalWorkers: WORKER_COUNT,
    successful: deployedWorkers.filter(w => w.status === 'deployed').length,
    failed: deployedWorkers.filter(w => w.status === 'failed').length,
    workers: deployedWorkers
  };
  
  fs.writeFileSync(
    path.join(__dirname, '../deployment-independent.json'),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  // Summary
  console.log('\n📋 DEPLOYMENT SUMMARY');
  console.log('========================');
  console.log(`✅ Successful: ${deploymentInfo.successful}/${WORKER_COUNT}`);
  console.log(`❌ Failed: ${deploymentInfo.failed}/${WORKER_COUNT}`);
  console.log(`🔒 Independence Level: MAXIMUM`);
  console.log(`🌐 Browser Types: Chrome, Firefox, Safari, Edge, Opera`);
  console.log(`⚡ Expected Performance: 600+ parcels/minute (20 workers)`);
  
  if (deploymentInfo.successful > 0) {
    console.log('\n🎯 Ready for ultra-fast independent scraping!');
    console.log('💡 Each worker appears as a completely different browser/user');
    console.log(`🚀 Run: npm run scrape:independent`);
    console.log(`📊 Deployed: ${deploymentInfo.successful} independent workers across global edge locations`);
  }
  
  // Clean up temporary config files
  for (let i = 0; i < WORKER_COUNT; i++) {
    const configPath = path.join(__dirname, `../wrangler-${workerConfigs[i].name}.toml`);
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  }
  
  return deployedWorkers;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run deployment
if (require.main === module) {
  deployIndependentWorkers()
    .then(workers => {
      console.log(`\n🏁 Deployment completed! ${workers.filter(w => w.status === 'deployed').length} workers ready.`);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Deployment failed:', error);
      process.exit(1);
    });
}

module.exports = { deployIndependentWorkers };