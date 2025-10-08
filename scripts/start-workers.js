#!/usr/bin/env node

/**
 * Start Independent Workers
 * 
 * This script triggers all deployed independent workers to start their 
 * autonomous scraping loops by sending them initial requests.
 */

const fs = require('fs');
const path = require('path');

class WorkerStarter {
    constructor() {
        this.deploymentInfo = this.loadDeploymentInfo();
    }

    loadDeploymentInfo() {
        try {
            const deploymentPath = path.join(__dirname, '..', 'deployment-independent.json');
            const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
            
            console.log(`📋 Loaded deployment info: ${deploymentData.successful}/${deploymentData.totalWorkers} workers deployed`);
            return deploymentData;
        } catch (error) {
            console.error('❌ Could not load deployment info:', error.message);
            console.error('   Make sure workers are deployed with: npm run deploy-independent');
            process.exit(1);
        }
    }

    async startAllWorkers() {
        console.log('🚀 STARTING INDEPENDENT WORKERS');
        console.log('================================');
        console.log(`🤖 Starting ${this.deploymentInfo.successful} deployed workers`);
        console.log('⚡ Each worker will begin autonomous scraping after initial trigger');
        
        const results = [];
        
        // Start workers in batches to avoid overwhelming
        const batchSize = 5;
        const workerBatches = [];
        
        for (let i = 0; i < this.deploymentInfo.workers.length; i += batchSize) {
            workerBatches.push(this.deploymentInfo.workers.slice(i, i + batchSize));
        }
        
        for (let batchIndex = 0; batchIndex < workerBatches.length; batchIndex++) {
            const batch = workerBatches[batchIndex];
            console.log(`\n📦 Starting batch ${batchIndex + 1}/${workerBatches.length} (${batch.length} workers)...`);
            
            const batchPromises = batch.map(worker => this.startWorker(worker));
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // Small delay between batches
            if (batchIndex < workerBatches.length - 1) {
                console.log('   ⏳ Cool-down: 3s...');
                await this.sleep(3000);
            }
        }
        
        this.generateStartupReport(results);
        return results;
    }

    async startWorker(worker) {
        console.log(`   🔄 Starting ${worker.id}...`);
        
        try {
            const startTime = Date.now();
            
            // Send initial request to trigger autonomous loop
            const response = await fetch(worker.url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Worker-Starter/1.0',
                    'X-Start-Worker': 'true'
                },
                signal: AbortSignal.timeout(15000) // 15s timeout
            });
            
            const responseTime = Date.now() - startTime;
            const success = response.ok;
            
            const result = {
                workerId: worker.id,
                workerNumber: worker.number,
                url: worker.url,
                success,
                responseTime,
                status: response.status,
                startTime: new Date().toISOString()
            };
            
            if (success) {
                console.log(`   ✅ ${worker.id}: Started successfully (${responseTime}ms)`);
                
                // Also trigger status endpoint to verify autonomous loop started
                try {
                    const statusResponse = await fetch(`${worker.url}/status`, {
                        headers: { 'User-Agent': 'Worker-Starter/1.0' },
                        signal: AbortSignal.timeout(10000)
                    });
                    
                    if (statusResponse.ok) {
                        const statusData = await statusResponse.text();
                        result.statusCheck = 'success';
                        
                        // Look for autonomous loop indicators
                        if (statusData.includes('autonomous') || statusData.includes('loop')) {
                            result.autonomousLoopStarted = true;
                        }
                    }
                } catch (statusError) {
                    result.statusCheck = 'failed';
                    result.statusError = statusError.message;
                }
                
            } else {
                console.log(`   ❌ ${worker.id}: Failed to start (${response.status})`);
                result.error = `HTTP ${response.status}`;
            }
            
            return result;
            
        } catch (error) {
            console.log(`   ❌ ${worker.id}: ${error.message}`);
            return {
                workerId: worker.id,
                workerNumber: worker.number,
                url: worker.url,
                success: false,
                error: error.message,
                startTime: new Date().toISOString()
            };
        }
    }

    generateStartupReport(results) {
        console.log('\n' + '='.repeat(60));
        console.log('📊 WORKER STARTUP REPORT');
        console.log('='.repeat(60));
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        const avgResponseTime = results
            .filter(r => r.success && r.responseTime)
            .reduce((sum, r) => sum + r.responseTime, 0) / successful || 0;
        
        const estimatedParcelsPerMin = successful * 30; // Conservative estimate
        
        console.log(`\n📈 SUMMARY:`);
        console.log(`   ✅ Successfully started: ${successful}/${results.length}`);
        console.log(`   ❌ Failed to start: ${failed}/${results.length}`);
        console.log(`   ⏱️  Average response time: ${Math.round(avgResponseTime)}ms`);
        
        if (successful > 0) {
            console.log(`\n🎉 SUCCESS! ${successful} workers are now running autonomously`);
            console.log('🔄 Each worker is now continuously:');
            console.log('   • Fetching parcels from global pool');
            console.log('   • Scraping Salt Lake County website');
            console.log('   • Processing owner information');
            console.log('   • Reporting progress to data collector');
            console.log(`\n📊 ESTIMATED PERFORMANCE:`);
            console.log(`   📈 Expected throughput: ~${estimatedParcelsPerMin} parcels/minute`);
            console.log(`   ⏰ Remaining parcels: 136,620`);
            console.log(`   🎯 Estimated completion: ~${Math.round(136620 / estimatedParcelsPerMin)} minutes`);
        }
        
        if (failed > 0) {
            console.log(`\n⚠️  FAILED WORKERS:`);
            const failedWorkers = results.filter(r => !r.success);
            for (const worker of failedWorkers) {
                console.log(`   ❌ ${worker.workerId}: ${worker.error || 'Unknown error'}`);
            }
            
            console.log('\n🔧 TROUBLESHOOTING:');
            console.log('   1. Check if data collector server is running');
            console.log('   2. Verify tunnel URL is accessible');
            console.log('   3. Check worker deployment status with: wrangler deployments list');
            console.log('   4. Try redeploying failed workers');
        }
        
        console.log('\n🔍 MONITORING:');
        console.log('   • Dashboard: http://10.0.0.217:5173 (if running)');
        console.log('   • Data Collector: http://localhost:3000');
        console.log('   • Worker Status: Visit any worker URL + /status');
        console.log('   • Progress: npm run monitor');
        
        // Save startup report
        const reportPath = path.join(__dirname, '..', 'worker-startup-report.json');
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalWorkers: results.length,
                successful,
                failed,
                avgResponseTime: Math.round(avgResponseTime),
                estimatedParcelsPerMin
            },
            results
        };
        
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n💾 Startup report saved to: worker-startup-report.json`);
        
        console.log('='.repeat(60));
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Handle global fetch for Node.js environment
if (typeof fetch === 'undefined') {
    global.fetch = require('node-fetch');
}

async function main() {
    const starter = new WorkerStarter();
    
    try {
        await starter.startAllWorkers();
        console.log('\n✅ Worker startup sequence completed');
    } catch (error) {
        console.error('\n❌ Worker startup failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = WorkerStarter;