#!/usr/bin/env node

/**
 * Advanced Configuration Matrix Benchmark
 * 
 * Tests different configurations to find optimal settings for maximum Utah parcel processing performance.
 * Uses your existing deployed workers with dynamic parameter adjustment.
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

class ConfigurationBenchmark {
    constructor() {
        this.dashboardUrl = 'http://10.0.0.217:5173';
        this.dataCollectorUrl = 'http://localhost:3000';
        this.results = [];
        
        // Configuration matrix to test
        this.testConfigurations = [
            // Conservative configs (good baseline)
            { workers: 5, batchSize: 2, delay: 2000, name: 'Conservative-Light' },
            { workers: 10, batchSize: 2, delay: 1500, name: 'Conservative-Medium' },
            
            // Balanced configs (current-ish)
            { workers: 10, batchSize: 4, delay: 1100, name: 'Balanced-Current' },
            { workers: 15, batchSize: 4, delay: 1100, name: 'Balanced-More-Workers' },
            { workers: 20, batchSize: 4, delay: 1100, name: 'Balanced-All-Workers' },
            
            // Aggressive configs (high throughput)
            { workers: 15, batchSize: 6, delay: 800, name: 'Aggressive-Medium' },
            { workers: 20, batchSize: 6, delay: 800, name: 'Aggressive-High' },
            { workers: 20, batchSize: 8, delay: 800, name: 'Aggressive-Max' },
            
            // Ultra-fast configs (may hit rate limits)
            { workers: 20, batchSize: 4, delay: 600, name: 'Ultra-Fast-Small-Batch' },
            { workers: 20, batchSize: 8, delay: 600, name: 'Ultra-Fast-Large-Batch' }
        ];
        
        this.testDuration = 300; // 5 minutes per test
        this.cooldownTime = 60; // 1 minute cooldown between tests
    }

    async runBenchmark() {
        console.log('🧪 ADVANCED CONFIGURATION MATRIX BENCHMARK');
        console.log('==========================================');
        console.log('🎯 Finding optimal settings for maximum Utah parcel processing');
        console.log(`📊 Testing ${this.testConfigurations.length} different configurations`);
        console.log(`⏱️  ${Math.round(this.testDuration / 60)} minutes per test + cooldown`);
        console.log(`🕐 Total estimated time: ${Math.round((this.testConfigurations.length * (this.testDuration + this.cooldownTime)) / 60)} minutes`);
        
        await this.verifyPrerequisites();
        
        console.log('\n🔬 CONFIGURATION TEST MATRIX:');
        console.log('Config Name              | Workers | Batch | Delay  | Expected Rate');
        console.log('-------------------------|---------|-------|--------|---------------');
        
        for (const config of this.testConfigurations) {
            const expectedRate = this.estimateRate(config);
            console.log(
                `${config.name.padEnd(24)} | ` +
                `${config.workers.toString().padStart(7)} | ` +
                `${config.batchSize.toString().padStart(5)} | ` +
                `${config.delay.toString().padStart(6)}ms | ` +
                `${expectedRate} parcels/min`
            );
        }
        
        console.log('\n🚀 Starting configuration tests...\n');
        
        // Run each configuration test
        for (let i = 0; i < this.testConfigurations.length; i++) {
            const config = this.testConfigurations[i];
            console.log(`\n${'='.repeat(80)}`);
            console.log(`🧪 TEST ${i + 1}/${this.testConfigurations.length}: ${config.name}`);
            console.log(`   Workers: ${config.workers}, Batch Size: ${config.batchSize}, Delay: ${config.delay}ms`);
            console.log(`${'='.repeat(80)}`);
            
            const result = await this.testConfiguration(config);
            this.results.push(result);
            
            // Progress update
            const remaining = this.testConfigurations.length - (i + 1);
            const remainingTime = remaining * (this.testDuration + this.cooldownTime);
            console.log(`\n✅ Test ${i + 1} completed: ${result.avgParcelsPerMinute} parcels/min`);
            console.log(`   📈 Success Rate: ${result.successRate}%`);
            console.log(`   ⚠️  Error Rate: ${result.errorRate}%`);
            
            if (remaining > 0) {
                console.log(`   ⏳ ${remaining} tests remaining (~${Math.round(remainingTime / 60)} minutes)`);
                console.log(`   😴 Cooldown: ${this.cooldownTime} seconds...`);
                await this.sleep(this.cooldownTime * 1000);
            }
        }
        
        this.analyzeResults();
        this.generateOptimizationReport();
    }

    estimateRate(config) {
        // Rough estimation based on workers * batches per minute
        const batchesPerMinute = 60000 / (config.delay + 1000); // +1000ms for processing time
        const theoreticalMax = Math.round(config.workers * batchesPerMinute * config.batchSize);
        
        // Apply efficiency factor (larger batches/more workers = lower efficiency)
        let efficiency = 0.8;
        if (config.workers > 15) efficiency -= 0.1;
        if (config.batchSize > 6) efficiency -= 0.1;
        if (config.delay < 800) efficiency -= 0.1;
        
        return Math.round(theoreticalMax * efficiency);
    }

    async verifyPrerequisites() {
        console.log('🔍 Verifying benchmark prerequisites...');
        
        // Check data collector
        try {
            const response = await fetch(this.dataCollectorUrl, { 
                signal: AbortSignal.timeout(5000) 
            });
            if (response.ok) {
                console.log('   ✅ Data collector is running');
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.log('   ❌ Data collector not accessible:', error.message);
            throw new Error('Data collector must be running for benchmark');
        }
        
        // Check dashboard
        try {
            const dashResponse = await fetch(this.dashboardUrl, { 
                signal: AbortSignal.timeout(5000) 
            });
            console.log('   ✅ Dashboard is accessible');
        } catch (error) {
            console.log('   ⚠️  Dashboard not accessible (monitoring will be limited)');
        }
        
        // Backup original script
        const originalScript = path.join(__dirname, 'start-independent.js');
        const backupScript = path.join(__dirname, 'start-independent.js.backup');
        
        if (!fs.existsSync(backupScript)) {
            fs.copyFileSync(originalScript, backupScript);
            console.log('   💾 Backed up original start-independent.js');
        }
        
        console.log('   🎯 Ready for configuration matrix testing!\n');
    }

    async testConfiguration(config) {
        const startTime = Date.now();
        
        // Get initial database state
        const initialStats = await this.getDatabaseStats();
        console.log(`   📊 Initial: ${initialStats.processed} processed, ${initialStats.remaining} remaining`);
        
        // Create temporary script with this configuration
        await this.createConfigScript(config);
        
        // Start the configured scraper
        console.log(`   🚀 Starting ${config.workers} workers with batch size ${config.batchSize}...`);
        const scraperProcess = this.startConfiguredScraper();
        
        // Collect metrics during test
        const metrics = [];
        const errorCount = { value: 0 };
        const successCount = { value: 0 };
        
        const metricsInterval = setInterval(async () => {
            try {
                const stats = await this.getDatabaseStats();
                const elapsed = (Date.now() - startTime) / 1000;
                const parcelsThisTest = stats.processed - initialStats.processed;
                const parcelsPerMinute = (parcelsThisTest / elapsed) * 60;
                
                metrics.push({
                    timestamp: Date.now(),
                    elapsed: Math.round(elapsed),
                    totalProcessed: stats.processed,
                    parcelsThisTest,
                    parcelsPerMinute: Math.round(parcelsPerMinute),
                    remainingParcels: stats.remaining
                });
                
                // Log progress every 45 seconds
                if (Math.round(elapsed) % 45 === 0 && elapsed > 30) {
                    const timeLeft = Math.round((this.testDuration - elapsed) / 60);
                    console.log(`   ⏱️  ${Math.round(elapsed/60)}m elapsed, ${timeLeft}m left | ${Math.round(parcelsPerMinute)} parcels/min | ${parcelsThisTest} processed`);
                }
            } catch (error) {
                console.log('   ⚠️  Metrics error:', error.message);
                errorCount.value++;
            }
        }, 15000); // Every 15 seconds
        
        // Monitor scraper output for errors/successes
        if (scraperProcess.stdout) {
            scraperProcess.stdout.on('data', (data) => {
                const output = data.toString();
                if (output.includes('SUCCESS')) successCount.value++;
                if (output.includes('ERROR') || output.includes('FAILED')) errorCount.value++;
                
                // Log some successes to show it's working
                if (output.includes('Owner:') && Math.random() < 0.1) { // 10% sampling
                    console.log(`   🏠 ${output.trim().substring(0, 120)}...`);
                }
            });
        }
        
        // Wait for test duration
        await this.sleep(this.testDuration * 1000);
        
        // Stop everything
        clearInterval(metricsInterval);
        this.stopProcess(scraperProcess);
        
        // Get final stats
        await this.sleep(5000); // Wait for final writes
        const finalStats = await this.getDatabaseStats();
        
        // Analyze results
        const result = this.analyzeTestResults(config, initialStats, finalStats, metrics, errorCount.value, successCount.value, startTime);
        
        console.log(`   📈 Results: ${result.parcelsProcessed} parcels, ${result.avgParcelsPerMinute} parcels/min`);
        console.log(`   🎯 Peak: ${result.peakParcelsPerMinute} parcels/min`);
        console.log(`   ✅ Success Rate: ${result.successRate}%`);
        console.log(`   ⚠️  Error Rate: ${result.errorRate}%`);
        
        return result;
    }

    async createConfigScript(config) {
        const templatePath = path.join(__dirname, 'start-independent.js.backup');
        const targetPath = path.join(__dirname, 'start-independent.js');
        
        let scriptContent = fs.readFileSync(templatePath, 'utf8');
        
        // Modify worker list to only include the number we want
        const workerSection = scriptContent.match(/const INDEPENDENT_WORKERS = \[(.*?)\];/s);
        if (workerSection) {
            const allWorkers = workerSection[1].split(',').filter(line => line.includes('url:'));
            const selectedWorkers = allWorkers.slice(0, config.workers);
            
            const newWorkerSection = `const INDEPENDENT_WORKERS = [\n${selectedWorkers.join(',')}\n];`;
            scriptContent = scriptContent.replace(/const INDEPENDENT_WORKERS = \[.*?\];/s, newWorkerSection);
        }
        
        // Modify configuration constants
        scriptContent = scriptContent.replace(/const BATCH_SIZE = \d+;/, `const BATCH_SIZE = ${config.batchSize};`);
        scriptContent = scriptContent.replace(/const INTER_BATCH_DELAY = \d+;/, `const INTER_BATCH_DELAY = ${config.delay};`);
        
        // Write the modified script
        fs.writeFileSync(targetPath, scriptContent);
        console.log(`   📝 Created config script: ${config.workers} workers, batch ${config.batchSize}, delay ${config.delay}ms`);
    }

    startConfiguredScraper() {
        const scriptPath = path.join(__dirname, 'start-independent.js');
        
        const scraperProcess = spawn('node', [scriptPath], {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: path.dirname(__dirname),
            detached: false
        });
        
        scraperProcess.on('error', (error) => {
            console.log('   ❌ Scraper process error:', error.message);
        });
        
        return scraperProcess;
    }

    stopProcess(process) {
        if (process && !process.killed) {
            try {
                // Kill the process and all children
                process.kill('SIGTERM');
                
                // Force kill if still running after 8 seconds
                setTimeout(() => {
                    if (!process.killed) {
                        process.kill('SIGKILL');
                    }
                }, 8000);
            } catch (error) {
                console.log('   ⚠️  Error stopping process:', error.message);
            }
        }
    }

    async getDatabaseStats() {
        return new Promise((resolve, reject) => {
            const sqlite3 = require('sqlite3').verbose();
            const db = new sqlite3.Database('./salt_lake_county_lir_parcels.db');
            
            db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM salt_lake_county_lir_parcels) as total,
                    (SELECT COUNT(*) FROM owner_data) as processed,
                    (SELECT COUNT(*) FROM salt_lake_county_lir_parcels) - (SELECT COUNT(*) FROM owner_data) as remaining
            `, (err, row) => {
                db.close();
                
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        total: row.total || 0,
                        processed: row.processed || 0,
                        remaining: row.remaining || 0
                    });
                }
            });
        });
    }

    analyzeTestResults(config, initialStats, finalStats, metrics, errorCount, successCount, startTime) {
        const actualDuration = (Date.now() - startTime) / 1000;
        const parcelsProcessed = finalStats.processed - initialStats.processed;
        const avgParcelsPerMinute = Math.round((parcelsProcessed / actualDuration) * 60);
        
        // Calculate success/error rates
        const totalAttempts = successCount + errorCount;
        const successRate = totalAttempts > 0 ? Math.round((successCount / totalAttempts) * 100) : 100;
        const errorRate = totalAttempts > 0 ? Math.round((errorCount / totalAttempts) * 100) : 0;
        
        // Find peak performance
        const peakParcelsPerMinute = metrics.length > 0 
            ? Math.max(...metrics.map(m => m.parcelsPerMinute))
            : avgParcelsPerMinute;
        
        // Calculate efficiency vs theoretical max
        const theoreticalMax = this.estimateRate(config);
        const efficiency = (avgParcelsPerMinute / theoreticalMax) * 100;
        
        return {
            config,
            configName: config.name,
            actualDuration,
            parcelsProcessed,
            avgParcelsPerMinute,
            peakParcelsPerMinute,
            successRate,
            errorRate,
            efficiency: Math.round(efficiency),
            theoreticalMax,
            initialStats,
            finalStats,
            metricsCount: metrics.length,
            detailedMetrics: metrics.slice(-10) // Keep last 10 metrics
        };
    }

    analyzeResults() {
        console.log('\n' + '='.repeat(100));
        console.log('📊 CONFIGURATION BENCHMARK RESULTS');
        console.log('='.repeat(100));
        
        // Sort results by performance
        const sortedResults = [...this.results].sort((a, b) => b.avgParcelsPerMinute - a.avgParcelsPerMinute);
        
        console.log('\n🏆 RANKING BY PERFORMANCE:');
        console.log('Rank | Config Name              | Parcels/Min | Peak    | Success | Error | Efficiency');
        console.log('-----|--------------------------|-------------|---------|---------|-------|------------');
        
        sortedResults.forEach((result, index) => {
            console.log(
                `${(index + 1).toString().padStart(4)} | ` +
                `${result.configName.padEnd(24)} | ` +
                `${result.avgParcelsPerMinute.toString().padStart(11)} | ` +
                `${result.peakParcelsPerMinute.toString().padStart(7)} | ` +
                `${(result.successRate + '%').padStart(7)} | ` +
                `${(result.errorRate + '%').padStart(5)} | ` +
                `${(result.efficiency + '%').padStart(10)}`
            );
        });
        
        // Find best configurations by category
        const bestOverall = sortedResults[0];
        const mostEfficient = [...this.results].sort((a, b) => b.efficiency - a.efficiency)[0];
        const mostStable = [...this.results].sort((a, b) => a.errorRate - b.errorRate)[0];
        
        console.log('\n🥇 CATEGORY WINNERS:');
        console.log(`   🚀 Highest Throughput: ${bestOverall.configName} (${bestOverall.avgParcelsPerMinute} parcels/min)`);
        console.log(`   ⚡ Most Efficient: ${mostEfficient.configName} (${mostEfficient.efficiency}% of theoretical max)`);
        console.log(`   🛡️  Most Stable: ${mostStable.configName} (${mostStable.errorRate}% error rate)`);
        
        console.log('\n📈 INSIGHTS:');
        this.generateInsights(sortedResults);
    }

    generateInsights(sortedResults) {
        // Worker count analysis
        const workerPerformance = {};
        sortedResults.forEach(result => {
            const workers = result.config.workers;
            if (!workerPerformance[workers]) {
                workerPerformance[workers] = [];
            }
            workerPerformance[workers].push(result.avgParcelsPerMinute);
        });
        
        console.log('   • Worker Count Analysis:');
        Object.entries(workerPerformance).forEach(([count, rates]) => {
            const avgRate = Math.round(rates.reduce((a, b) => a + b) / rates.length);
            console.log(`     - ${count} workers: ${avgRate} avg parcels/min`);
        });
        
        // Batch size analysis
        const batchPerformance = {};
        sortedResults.forEach(result => {
            const batch = result.config.batchSize;
            if (!batchPerformance[batch]) {
                batchPerformance[batch] = [];
            }
            batchPerformance[batch].push(result.avgParcelsPerMinute);
        });
        
        console.log('   • Batch Size Analysis:');
        Object.entries(batchPerformance).forEach(([size, rates]) => {
            const avgRate = Math.round(rates.reduce((a, b) => a + b) / rates.length);
            console.log(`     - Batch ${size}: ${avgRate} avg parcels/min`);
        });
        
        // Performance trends
        if (sortedResults[0].errorRate > 10) {
            console.log('   ⚠️  High error rates detected - consider more conservative settings');
        }
        
        if (sortedResults[0].efficiency < 70) {
            console.log('   🔧 Low efficiency suggests rate limiting or resource constraints');
        }
        
        const topConfigs = sortedResults.slice(0, 3);
        if (topConfigs.every(r => r.config.workers >= 15)) {
            console.log('   📈 Higher worker counts consistently perform better');
        }
    }

    generateOptimizationReport() {
        const bestConfig = this.results.sort((a, b) => b.avgParcelsPerMinute - a.avgParcelsPerMinute)[0];
        
        console.log('\n' + '='.repeat(100));
        console.log('🎯 OPTIMIZATION RECOMMENDATIONS');
        console.log('='.repeat(100));
        
        console.log(`\n🏆 RECOMMENDED OPTIMAL CONFIGURATION:`);
        console.log(`   Configuration: ${bestConfig.configName}`);
        console.log(`   Workers: ${bestConfig.config.workers}`);
        console.log(`   Batch Size: ${bestConfig.config.batchSize}`);
        console.log(`   Inter-batch Delay: ${bestConfig.config.delay}ms`);
        console.log(`   Expected Performance: ${bestConfig.avgParcelsPerMinute} parcels/minute`);
        console.log(`   Peak Performance: ${bestConfig.peakParcelsPerMinute} parcels/minute`);
        console.log(`   Success Rate: ${bestConfig.successRate}%`);
        console.log(`   Efficiency: ${bestConfig.efficiency}% of theoretical maximum`);
        
        // Calculate completion estimates
        const remainingParcels = bestConfig.finalStats.remaining;
        if (remainingParcels > 0) {
            const hoursToComplete = (remainingParcels / bestConfig.avgParcelsPerMinute) / 60;
            console.log(`\n⏰ COMPLETION ESTIMATES:`);
            console.log(`   Remaining Parcels: ${remainingParcels.toLocaleString()}`);
            console.log(`   Estimated Time: ${hoursToComplete.toFixed(1)} hours`);
            console.log(`   Expected Completion: ${new Date(Date.now() + hoursToComplete * 3600000).toLocaleString()}`);
        }
        
        console.log(`\n🔧 TO APPLY OPTIMAL SETTINGS:`);
        console.log(`   1. Edit scripts/start-independent.js:`);
        console.log(`      - Set BATCH_SIZE = ${bestConfig.config.batchSize}`);
        console.log(`      - Set INTER_BATCH_DELAY = ${bestConfig.config.delay}`);
        console.log(`      - Use ${bestConfig.config.workers} workers from INDEPENDENT_WORKERS array`);
        console.log(`   2. Run: npm run scrape:independent`);
        console.log(`   3. Monitor via dashboard: ${this.dashboardUrl}`);
        
        // Save detailed report
        const reportPath = path.join(__dirname, '..', 'configuration-benchmark-results.json');
        const report = {
            timestamp: new Date().toISOString(),
            testType: 'configuration-matrix-benchmark',
            bestConfiguration: bestConfig,
            allResults: this.results,
            summary: {
                totalConfigurations: this.results.length,
                bestPerformance: bestConfig.avgParcelsPerMinute,
                testDurationMinutes: Math.round(this.testDuration / 60),
                totalBenchmarkHours: Math.round((this.results.length * (this.testDuration + this.cooldownTime)) / 3600)
            },
            recommendations: {
                workers: bestConfig.config.workers,
                batchSize: bestConfig.config.batchSize,
                delay: bestConfig.config.delay,
                expectedRate: bestConfig.avgParcelsPerMinute
            }
        };
        
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n💾 Detailed results saved: ${reportPath}`);
        
        // Restore original script
        const originalScript = path.join(__dirname, 'start-independent.js');
        const backupScript = path.join(__dirname, 'start-independent.js.backup');
        if (fs.existsSync(backupScript)) {
            fs.copyFileSync(backupScript, originalScript);
            console.log('📄 Original start-independent.js restored');
        }
        
        console.log('='.repeat(100));
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
    const benchmark = new ConfigurationBenchmark();
    
    try {
        await benchmark.runBenchmark();
        console.log('\n✅ Configuration benchmark completed successfully');
        console.log('🎯 Apply the recommended settings for optimal performance');
    } catch (error) {
        console.error('\n❌ Benchmark failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = ConfigurationBenchmark;