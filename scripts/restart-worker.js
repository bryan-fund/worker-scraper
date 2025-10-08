#!/usr/bin/env node

/**
 * Restart Individual Cloudflare Worker
 * Used when workers need to be restarted due to high failure rates
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Import worker configurations from deploy script
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
  { name: 'slc-scraper-upsilon', delay: 4, browserType: 'opera' },
  { name: 'slc-scraper-phi', delay: 3, browserType: 'chrome' },
  { name: 'slc-scraper-chi', delay: 5, browserType: 'firefox' },
  { name: 'slc-scraper-psi', delay: 4, browserType: 'safari' },
  { name: 'slc-scraper-omega', delay: 6, browserType: 'edge' },
  { name: 'slc-scraper-apex', delay: 2, browserType: 'opera' },
  { name: 'slc-scraper-nexus', delay: 7, browserType: 'chrome' },
  { name: 'slc-scraper-vertex', delay: 4, browserType: 'firefox' },
  { name: 'slc-scraper-matrix', delay: 5, browserType: 'safari' },
  { name: 'slc-scraper-cortex', delay: 3, browserType: 'edge' },
  { name: 'slc-scraper-vortex', delay: 6, browserType: 'opera' }
];

async function restartWorker(workerName) {
  console.log(`🔄 Restarting worker: ${workerName}`);
  
  // Find worker configuration
  const config = workerConfigs.find(w => w.name === workerName);
  if (!config) {
    throw new Error(`Worker configuration not found for: ${workerName}`);
  }
  
  try {
    // Generate wrangler.toml for this specific worker
  const wranglerConfig = `
name = "${config.name}"
main = "src/worker-independent.js"
compatibility_date = "2024-10-07"
compatibility_flags = ["nodejs_compat"]

[vars]
WORKER_ID = "${config.name}"
RATE_LIMIT_MS = "200"
BATCH_SIZE = "1"
CONTINUOUS = "1"
LOCAL_COLLECTOR_URL = "https://would-hollywood-ours-labour.trycloudflare.com/collect"
COLLECTOR_BASE = "https://would-hollywood-ours-labour.trycloudflare.com"
COLLECTOR_TOKEN = "${process.env.COLLECTOR_TOKEN || 'your-secure-token-here'}"
CF_ACCESS_CLIENT_ID = "${process.env.CF_ACCESS_CLIENT_ID || ''}"
CF_ACCESS_CLIENT_SECRET = "${process.env.CF_ACCESS_CLIENT_SECRET || ''}"
COLLECTOR_ALLOW_CF_ACCESS = "${process.env.COLLECTOR_ALLOW_CF_ACCESS || '0'}"
BROWSER_TYPE = "${config.browserType}"
BASE_DELAY = "${config.delay}"

# Worker-specific settings for independence
[limits]
cpu_ms = 30000
memory_mb = 128
`;
    
    const configPath = path.join(__dirname, `../wrangler-${config.name}.toml`);
    fs.writeFileSync(configPath, wranglerConfig.trim());
    
    console.log(`📝 Generated config: wrangler-${config.name}.toml`);
    
    // Deploy the restarted worker
    const deployCommand = `cd "${path.dirname(__dirname)}" && npx wrangler deploy --config wrangler-${config.name}.toml`;
    console.log(`🚀 Deploying ${config.name}...`);
    
    const deployOutput = execSync(deployCommand, { encoding: 'utf8', timeout: 120000 });
    
    // Extract the worker URL from deployment output
    const urlMatch = deployOutput.match(/https:\/\/[^\s]+\.workers\.dev/);
    const workerUrl = urlMatch ? urlMatch[0] : `https://${config.name}.w2ntsrpc5v.workers.dev`;
    
    console.log(`✅ Worker ${workerName} restarted successfully!`);
    console.log(`🌐 URL: ${workerUrl}`);
    
    return {
      name: workerName,
      url: workerUrl,
      status: 'restarted',
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error(`❌ Failed to restart worker ${workerName}:`, error.message);
    throw error;
  }
}

// Main function for command line usage
async function main() {
  const workerName = process.argv[2];
  
  if (!workerName) {
    console.error('❌ Usage: node restart-worker.js <worker-name>');
    console.error('   Example: node restart-worker.js slc-scraper-alpha');
    process.exit(1);
  }
  
  try {
    await restartWorker(workerName);
  } catch (error) {
    console.error(`❌ Restart failed:`, error.message);
    process.exit(1);
  }
}

// Export for use by other scripts
module.exports = { restartWorker };

// Run if called directly
if (require.main === module) {
  main();
}