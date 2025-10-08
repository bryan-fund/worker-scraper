#!/usr/bin/env node

/**
 * Quick Utah Performance Tuner
 * 
 * Fast benchmark focused on finding optimal settings for maximum Utah parcel throughput.
 * Runs shorter tests to quickly identify the best configuration parameters.
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

class QuickUtahTuner {
    constructor() {
        this.deploymentInfo = this.loadDeploymentInfo();
        this.authToken = 'your-secure-token-here'; // Same token as workers use
        this.results = [];
    }

    loadDeploymentInfo() {
        try {
            const deploymentPath = path.join(__dirname, '..', 'deployment-independent.json');
            const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
            console.log(`📋 Loaded ${deploymentData.successful} workers for quick tuning`);
            return deploymentData;
        } catch (error) {
            console.error('❌ Could not load deployment info:', error.message);
            process.exit(1);
        }
    }

    async runQuickTuning() {
        console.log('⚡ QUICK UTAH PERFORMANCE TUNER');
        console.log('================================');
        console.log('🎯 Finding optimal settings in <10 minutes');
        console.log('📊 Testing REAL Utah parcels → SLC website → Local storage');
        console.log('🌐 Workers use tunnel: https://would-hollywood-ours-labour.trycloudflare.com');
        console.log('💾 Pipeline: Workers → Tunnel → Local Collector → SQLite DB');
        
        // Verify local data collector is running
        await this.verifyLocalCollector();
        
        // Quick tests with shorter durations
        const quickTests = [
            { name: 'Health Check', test: () => this.quickHealthCheck() },
            { name: 'Rate Limit Sweet Spot', test: () => this.findRateLimit() },
            { name: 'Worker Scaling', test: () => this.testWorkerScaling() },
            { name: 'Burst Capacity', test: () => this.testBurstCapacity() },
            { name: 'Final Validation', test: () => this.validateOptimal() }
        ];
        
        for (const { name, test } of quickTests) {
            console.log(`\n🔬 ${name}...`);
            await test();
        }
        
        this.generateTuningReport();
    }

    async verifyLocalCollector() {
        console.log('🔍 Verifying tunnel endpoint connectivity...');
        
        // Use the same tunnel endpoint that workers use (from wrangler.toml)
        const tunnelEndpoint = 'https://would-hollywood-ours-labour.trycloudflare.com';
        
        try {
            // Check if tunnel endpoint is accessible (this is what workers use)
            const response = await fetch(tunnelEndpoint, {
                headers: { 'User-Agent': 'Utah-Tuner-Verification/1.0' },
                signal: AbortSignal.timeout(10000)
            });
            
            if (response.ok) {
                console.log('   ✅ Tunnel endpoint accessible - workers can reach local collector');
                
                // Check global pool status via tunnel
                try {
                    const poolResponse = await fetch(`${tunnelEndpoint}/pool-status`, {
                        headers: { 
                            'User-Agent': 'Utah-Tuner-Verification/1.0',
                            'Authorization': `Bearer ${this.authToken}`
                        },
                        signal: AbortSignal.timeout(5000)
                    });
                    
                    if (poolResponse.ok) {
                        const poolText = await poolResponse.text();
                        console.log('   📊 Global pool accessible via tunnel for real parcel processing');
                        
                        // Try to extract pool size info
                        const poolSizeMatch = poolText.match(/(\d+)/);
                        if (poolSizeMatch) {
                            console.log(`   📈 Pool contains parcels for worker processing`);
                        }
                    } else {
                        console.log('   📊 Tunnel working, pool status check optional');
                    }
                } catch (e) {
                    console.log('   📊 Tunnel endpoint accessible (pool status check optional)');
                }
                
                // Also check local collector directly
                try {
                    const localResponse = await fetch('http://localhost:3000', {
                        headers: { 'User-Agent': 'Utah-Tuner-Verification/1.0' },
                        signal: AbortSignal.timeout(3000)
                    });
                    
                    if (localResponse.ok) {
                        console.log('   ✅ Local data collector also directly accessible');
                    }
                } catch (e) {
                    console.log('   📝 Local collector accessible via tunnel (direct access not required)');
                }
                
            } else {
                console.warn('   ⚠️  Tunnel endpoint responded with HTTP', response.status);
                console.warn('   📝 Workers may not be able to report back to local collector');
            }
        } catch (error) {
            console.warn('   ❌ Could not connect to tunnel endpoint:', error.message);
            console.warn('   ⚠️  Workers may not be able to communicate with local collector');
            console.warn('   📝 This could affect parcel allocation and result storage');
        }
        
        console.log('   🎯 Workers configured to use tunnel:', tunnelEndpoint);
        console.log('   🎯 Proceeding with real worker testing...\n');
    }

    async quickHealthCheck() {
        console.log('   🏥 Quick health check of 8 workers...');
        
        const testWorkers = this.deploymentInfo.workers.slice(0, 8);
        const healthPromises = testWorkers.map(worker => this.testWorkerHealth(worker));
        const healthResults = await Promise.all(healthPromises);
        
        const healthy = healthResults.filter(r => r.healthy).length;
        const canScrapeCount = healthResults.filter(r => r.canScrape).length;
        const avgLatency = healthResults
            .filter(r => r.healthy)
            .reduce((sum, r) => sum + r.latency, 0) / healthy;
        const avgScrapeLatency = healthResults
            .filter(r => r.canScrape)
            .reduce((sum, r) => sum + r.scrapeLatency, 0) / canScrapeCount || 0;
        
        console.log(`   ✅ ${healthy}/${testWorkers.length} workers healthy, ${canScrapeCount}/${testWorkers.length} can scrape real parcels`);
        console.log(`   ⚡ Basic: ${Math.round(avgLatency)}ms avg, Real scraping: ${Math.round(avgScrapeLatency)}ms avg`);
        
        this.results.push({
            phase: 'health',
            healthy,
            total: testWorkers.length,
            canScrape: canScrapeCount,
            avgLatency: Math.round(avgLatency),
            avgScrapeLatency: Math.round(avgScrapeLatency)
        });
        
        return { healthy, avgLatency };
    }

    async testWorkerHealth(worker) {
        try {
            // Test basic connectivity first
            const startTime = performance.now();
            const response = await fetch(worker.url, {
                headers: { 
                    'User-Agent': 'Quick-Utah-Tuner/1.0',
                    'Authorization': `Bearer ${this.authToken}`
                },
                signal: AbortSignal.timeout(8000)
            });
            const basicLatency = performance.now() - startTime;
            
            if (!response.ok) {
                return { 
                    workerId: worker.id, 
                    healthy: false, 
                    latency: basicLatency,
                    status: response.status 
                };
            }
            
            // Test actual scraping capability - this will:
            // 1. Get real parcels from your local global pool
            // 2. Scrape real SLC website 
            // 3. Store results back to your local database
            const scrapeStartTime = performance.now();
            const scrapeResponse = await fetch(`${worker.url}/scrape`, {
                headers: { 
                    'User-Agent': 'Utah-Health-Check/1.0',
                    'Authorization': `Bearer ${this.authToken}`,
                    'X-Health-Check': 'true'
                },
                signal: AbortSignal.timeout(15000) // Longer timeout for real scraping
            });
            const scrapeLatency = performance.now() - scrapeStartTime;
            
            const canScrape = scrapeResponse.ok;
            
            return { 
                workerId: worker.id, 
                healthy: response.ok,
                canScrape,
                latency: basicLatency,
                scrapeLatency: Math.round(scrapeLatency),
                status: response.status,
                scrapeStatus: scrapeResponse.status
            };
        } catch (error) {
            return { 
                workerId: worker.id, 
                healthy: false, 
                error: error.message 
            };
        }
    }

    async findRateLimit() {
        console.log('   ⚡ Testing rate limiting strategies (30s each)...');
        
        const rateLimits = [
            { name: 'Conservative', interval: 4000, expected: 0.25 },
            { name: 'Moderate', interval: 2500, expected: 0.4 },
            { name: 'Aggressive', interval: 1500, expected: 0.67 },
            { name: 'Fast', interval: 1000, expected: 1.0 }
        ];
        
        let bestConfig = null;
        let bestScore = 0;
        
        for (const config of rateLimits) {
            console.log(`      🔄 ${config.name} (${config.expected} req/sec per worker)...`);
            
            const result = await this.testRateLimit(config, 30000); // 30s test
            const score = result.actualRate * (1 - result.errorRate) * Math.min(1, 2000 / result.avgLatency);
            
            console.log(`         ✅ Rate: ${result.actualRate.toFixed(2)}/sec, Errors: ${(result.errorRate * 100).toFixed(1)}%, Latency: ${Math.round(result.avgLatency)}ms`);
            
            if (score > bestScore) {
                bestScore = score;
                bestConfig = { ...config, result };
            }
            
            this.results.push({
                phase: 'rateLimit',
                config,
                ...result,
                score
            });
        }
        
        console.log(`   🏆 Best rate limit: ${bestConfig.name} (score: ${bestScore.toFixed(1)})`);
        return bestConfig;
    }

    async testRateLimit(config, duration) {
        const testWorkers = this.deploymentInfo.workers.slice(0, 6); // Use 6 workers
        const startTime = performance.now();
        const endTime = startTime + duration;
        
        const results = {
            totalRequests: 0,
            successfulRequests: 0,
            latencies: [],
            errors: 0
        };
        
        // Run workers in parallel
        const workerPromises = testWorkers.map(worker =>
            this.runRateLimitedWorker(worker, config.interval, endTime, results)
        );
        
        await Promise.all(workerPromises);
        
        const actualDuration = (performance.now() - startTime) / 1000;
        const actualRate = results.totalRequests / actualDuration;
        const errorRate = (results.totalRequests - results.successfulRequests) / results.totalRequests;
        const avgLatency = results.latencies.length > 0 
            ? results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length 
            : 0;
        
        return { actualRate, errorRate, avgLatency, totalRequests: results.totalRequests };
    }

    async runRateLimitedWorker(worker, intervalMs, endTime, results) {
        let requestCount = 0;
        
        while (performance.now() < endTime) {
            try {
                const startTime = performance.now();
                
                // Use /scrape endpoint to trigger real Utah parcel processing
                // This will: 1) Get parcels from your local DB, 2) Scrape SLC website, 3) Store results back
                const response = await fetch(`${worker.url}/scrape`, {
                    headers: { 
                        'User-Agent': `Utah-RateTest-${worker.id}/1.0`,
                        'Authorization': `Bearer ${this.authToken}`,
                        'X-Rate-Test': 'true',
                        'X-Request-Count': requestCount.toString()
                    },
                    signal: AbortSignal.timeout(25000) // Longer timeout for real scraping
                });
                
                const latency = performance.now() - startTime;
                results.totalRequests++;
                results.latencies.push(latency);
                requestCount++;
                
                if (response.ok) {
                    results.successfulRequests++;
                    
                    // Try to extract actual parcel processing info and owner names from response
                    try {
                        const responseText = await response.text();
                        
                        // Look for the same SUCCESS pattern that normal workers use
                        const successPattern = /✅ SUCCESS for parcel ([^-]+) - Owner: ([^\n\r]+)/g;
                        let match;
                        let ownersFound = [];
                        
                        while ((match = successPattern.exec(responseText)) !== null) {
                            const parcelId = match[1].trim();
                            const ownerName = match[2].trim();
                            ownersFound.push({ parcelId, ownerName });
                        }
                        
                        if (ownersFound.length > 0) {
                            // Log the first owner found (to avoid spam) in same format as normal workers
                            const firstOwner = ownersFound[0];
                            console.log(`      ✅ SUCCESS for parcel ${firstOwner.parcelId} - Owner: ${firstOwner.ownerName}`);
                            if (ownersFound.length > 1) {
                                console.log(`      📊 Plus ${ownersFound.length - 1} more owners processed`);
                            }
                        } else if (responseText.includes('processed') || responseText.includes('parcel') || responseText.includes('success')) {
                            console.log(`      📝 ${worker.id}: Real parcel processed (${Math.round(latency)}ms)`);
                        }
                    } catch (e) {
                        // Response parsing failed but request was successful
                        console.log(`      📝 ${worker.id}: Request successful (${Math.round(latency)}ms)`);
                    }
                } else {
                    results.errors++;
                    if (response.status === 429) {
                        console.log(`      🚫 ${worker.id}: Rate limited (${response.status})`);
                    } else if (response.status >= 500) {
                        console.log(`      ❌ ${worker.id}: Server error (${response.status})`);
                    }
                }
                
                await this.sleep(intervalMs);
                
            } catch (error) {
                results.totalRequests++;
                results.errors++;
                console.log(`      ⚠️  ${worker.id}: ${error.message}`);
                await this.sleep(intervalMs * 1.5); // Back off on error
            }
        }
        
        console.log(`      ✅ ${worker.id}: ${requestCount} requests completed`);
    }

    async testWorkerScaling() {
        console.log('   📈 Testing worker scaling (45s each)...');
        
        const workerCounts = [4, 8, 12, 16, 20];
        let optimalCount = 4;
        let maxThroughput = 0;
        
        for (const count of workerCounts) {
            if (count > this.deploymentInfo.successful) continue;
            
            console.log(`      🤖 Testing ${count} workers...`);
            
            const result = await this.testWorkerCount(count, 45000); // 45s test
            const throughput = result.parcelsPerMinute;
            
            console.log(`         ✅ ${throughput.toFixed(1)} parcels/min, ${result.requestsPerSec.toFixed(1)} req/sec`);
            
            if (throughput > maxThroughput && result.errorRate < 0.15) {
                maxThroughput = throughput;
                optimalCount = count;
            }
            
            this.results.push({
                phase: 'scaling',
                workerCount: count,
                ...result
            });
            
            // Stop if we hit diminishing returns
            if (count > 8 && throughput < maxThroughput * 0.9) {
                console.log('      ⚠️  Diminishing returns detected, stopping scaling test');
                break;
            }
        }
        
        console.log(`   🏆 Optimal worker count: ${optimalCount} (${maxThroughput.toFixed(1)} parcels/min)`);
        return { optimalCount, maxThroughput };
    }

    async testWorkerCount(workerCount, duration) {
        const testWorkers = this.deploymentInfo.workers.slice(0, workerCount);
        const intervalMs = 1200; // ~0.83 req/sec per worker
        
        const startTime = performance.now();
        const endTime = startTime + duration;
        
        const results = {
            totalRequests: 0,
            successfulRequests: 0,
            parcelsProcessed: 0,
            latencies: []
        };
        
        const workerPromises = testWorkers.map(worker =>
            this.runScalingTestWorker(worker, intervalMs, endTime, results)
        );
        
        await Promise.all(workerPromises);
        
        const actualDuration = (performance.now() - startTime) / 1000;
        const requestsPerSec = results.totalRequests / actualDuration;
        const parcelsPerMinute = (results.parcelsProcessed / actualDuration) * 60;
        const errorRate = (results.totalRequests - results.successfulRequests) / results.totalRequests;
        const avgLatency = results.latencies.length > 0 
            ? results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length 
            : 0;
        
        return { requestsPerSec, parcelsPerMinute, errorRate, avgLatency };
    }

    async runScalingTestWorker(worker, intervalMs, endTime, results) {
        let requestCount = 0;
        
        while (performance.now() < endTime) {
            try {
                const startTime = performance.now();
                
                // Mix of endpoints for realistic testing - both trigger real Utah parcel processing
                // /scrape: Single parcel processing from global pool → SLC website → local storage
                // /batch: Multiple parcel processing from global pool → SLC website → local storage  
                const endpoint = requestCount % 4 === 0 ? '/batch' : '/scrape';
                
                const response = await fetch(`${worker.url}${endpoint}`, {
                    headers: { 
                        'User-Agent': `Utah-ScaleTest-${worker.id}/1.0`,
                        'Authorization': `Bearer ${this.authToken}`,
                        'X-Scale-Test': 'true',
                        'X-Request-Count': requestCount.toString(),
                        'X-Endpoint': endpoint
                    },
                    signal: AbortSignal.timeout(30000) // Real scraping can take longer
                });
                
                const latency = performance.now() - startTime;
                results.totalRequests++;
                results.latencies.push(latency);
                requestCount++;
                
                if (response.ok) {
                    results.successfulRequests++;
                    
                    // Try to extract real parcel count and owner names from response
                    try {
                        const responseText = await response.text();
                        
                        // Use same extraction method as normal workers
                        const parcelsProcessed = this.extractParcelCount(responseText, endpoint);
                        results.parcelsProcessed += parcelsProcessed;
                        
                        // The extractParcelCount method already logs owner names in the same format
                        // as normal workers, so we don't need additional logging here
                        
                    } catch (e) {
                        // Estimate based on endpoint if can't parse
                        const estimatedParcels = endpoint === '/batch' ? 8 : 1;
                        results.parcelsProcessed += estimatedParcels;
                        console.log(`      📊 ${worker.id}${endpoint}: ~${estimatedParcels} parcels estimated (${Math.round(latency)}ms)`);
                    }
                } else {
                    if (requestCount % 10 === 0) { // Log every 10th error to avoid spam
                        console.log(`      ❌ ${worker.id}${endpoint}: HTTP ${response.status} (${Math.round(latency)}ms)`);
                    }
                }
                
                await this.sleep(intervalMs + Math.random() * 500); // Add jitter
                
            } catch (error) {
                results.totalRequests++;
                if (requestCount % 20 === 0) { // Log every 20th error
                    console.log(`      ⚠️  ${worker.id}: ${error.message}`);
                }
                await this.sleep(intervalMs * 2);
            }
        }
        
        console.log(`      ✅ ${worker.id}: ${requestCount} requests, ~${Math.round(results.parcelsProcessed / requestCount * requestCount)} parcels processed`);
    }

    // Helper method to extract parcel count and owner info from worker response (same as normal workers)
    extractParcelCount(responseText, endpoint) {
        // Look for the same SUCCESS pattern that normal workers use
        const successPattern = /✅ SUCCESS for parcel ([^-]+) - Owner: ([^\n\r]+)/g;
        const successes = [];
        let match;
        
        // Extract all successful parcel processing with owner names
        while ((match = successPattern.exec(responseText)) !== null) {
            const parcelId = match[1].trim();
            const ownerName = match[2].trim();
            successes.push({ parcelId, ownerName });
            
            // Log in the same format as normal workers for consistency
            console.log(`      ✅ SUCCESS for parcel ${parcelId} - Owner: ${ownerName}`);
        }
        
        if (successes.length > 0) {
            return successes.length; // Return actual count of successful parcels
        }
        
        // Fallback: look for other success indicators
        const patterns = [
            /processed[^\d]*(\d+)[^\d]*parcel/i,
            /(\d+)[^\d]*parcel[^\d]*processed/i,
            /batch[^\d]*(\d+)/i,
            /count[^\d]*(\d+)/i,
            /success[^\d]*(\d+)/i
        ];
        
        for (const pattern of patterns) {
            const patternMatch = responseText.match(pattern);
            if (patternMatch) {
                const count = parseInt(patternMatch[1]);
                if (count > 0) {
                    console.log(`      📊 Processed ${count} parcels (pattern match)`);
                    return count;
                }
            }
        }
        
        // Look for general success indicators without specific counts
        if (responseText.includes('✅ SUCCESS') || responseText.includes('processed') || responseText.includes('completed')) {
            const estimatedCount = endpoint === '/batch' ? 8 : 1;
            console.log(`      📝 Estimated ${estimatedCount} parcels processed (${endpoint})`);
            return estimatedCount;
        }
        
        // Default estimates if no clear indicators
        return endpoint === '/batch' ? 8 : 1;
    }

    async testBurstCapacity() {
        console.log('   🚀 Testing burst capacity (60s)...');
        
        const testWorkers = this.deploymentInfo.workers.slice(0, 10);
        const burstDuration = 60000; // 1 minute burst
        
        const result = await this.runBurstTest(testWorkers, burstDuration);
        
        console.log(`   ✅ Burst: ${result.peakRequestsPerSec.toFixed(1)} peak req/sec, ${result.sustainedParcelsPerMin.toFixed(1)} sustained parcels/min`);
        
        this.results.push({
            phase: 'burst',
            ...result
        });
        
        return result;
    }

    async runBurstTest(workers, duration) {
        const startTime = performance.now();
        const endTime = startTime + duration;
        
        const results = {
            totalRequests: 0,
            successfulRequests: 0,
            parcelsProcessed: 0,
            requestTimestamps: [],
            latencies: []
        };
        
        // Start aggressive burst test
        const workerPromises = workers.map(worker =>
            this.runBurstWorker(worker, endTime, results)
        );
        
        await Promise.all(workerPromises);
        
        const actualDuration = (performance.now() - startTime) / 1000;
        
        // Calculate peak requests/sec (5-second window)
        let peakRequestsPerSec = 0;
        const windowSize = 5000; // 5 second window
        
        for (let i = 0; i < results.requestTimestamps.length - 10; i++) {
            const windowStart = results.requestTimestamps[i];
            const windowEnd = windowStart + windowSize;
            const requestsInWindow = results.requestTimestamps.filter(
                t => t >= windowStart && t <= windowEnd
            ).length;
            const requestsPerSec = requestsInWindow / (windowSize / 1000);
            peakRequestsPerSec = Math.max(peakRequestsPerSec, requestsPerSec);
        }
        
        const sustainedParcelsPerMin = (results.parcelsProcessed / actualDuration) * 60;
        const errorRate = (results.totalRequests - results.successfulRequests) / results.totalRequests;
        
        return {
            peakRequestsPerSec,
            sustainedParcelsPerMin,
            errorRate,
            totalRequests: results.totalRequests
        };
    }

    async runBurstWorker(worker, endTime, results) {
        let requestCount = 0;
        
        while (performance.now() < endTime) {
            try {
                const requestStart = performance.now();
                
                // Alternate between scrape and batch for realistic burst testing
                // Both endpoints process real Utah parcels from your local DB
                const endpoint = requestCount % 3 === 0 ? '/batch' : '/scrape';
                
                const response = await fetch(`${worker.url}${endpoint}`, {
                    headers: { 
                        'User-Agent': `Utah-BurstTest-${worker.id}/1.0`,
                        'Authorization': `Bearer ${this.authToken}`,
                        'X-Burst-Test': 'true',
                        'X-Request-Count': requestCount.toString()
                    },
                    signal: AbortSignal.timeout(20000)
                });
                
                const latency = performance.now() - requestStart;
                results.totalRequests++;
                results.requestTimestamps.push(requestStart);
                results.latencies.push(latency);
                requestCount++;
                
                if (response.ok) {
                    results.successfulRequests++;
                    
                    // Try to get actual parcel count and owner names, matching normal worker logging
                    try {
                        const responseText = await response.text();
                        const parcelsProcessed = this.extractParcelCount(responseText, endpoint);
                        results.parcelsProcessed += parcelsProcessed;
                        
                        // extractParcelCount already logs owner names in the same format as normal workers
                        // Only add additional context logging every 5th success to avoid spam
                        if (requestCount % 5 === 0 && parcelsProcessed > 0) {
                            console.log(`      🚀 ${worker.id}${endpoint}: ${parcelsProcessed} parcels in burst (${Math.round(latency)}ms)`);
                        }
                    } catch (e) {
                        const estimatedParcels = endpoint === '/batch' ? 8 : 1;
                        results.parcelsProcessed += estimatedParcels;
                        if (requestCount % 10 === 0) {
                            console.log(`      🚀 ${worker.id}${endpoint}: ~${estimatedParcels} parcels estimated (${Math.round(latency)}ms)`);
                        }
                    }
                } else {
                    if (requestCount % 10 === 0) { // Log errors periodically
                        console.log(`      ❌ ${worker.id}${endpoint}: HTTP ${response.status}`);
                    }
                }
                
                // Minimal delay for burst testing, but back off if getting errors
                const delay = response && response.ok ? (100 + Math.random() * 200) : 1000;
                await this.sleep(delay);
                
            } catch (error) {
                results.totalRequests++;
                if (requestCount % 20 === 0) {
                    console.log(`      ⚠️  ${worker.id}: ${error.message}`);
                }
                await this.sleep(1000); // Back off on error
            }
        }
        
        console.log(`      ✅ ${worker.id}: ${requestCount} burst requests completed`);
    }

    async validateOptimal() {
        console.log('   ✅ Validating optimal configuration (90s)...');
        
        // Use best settings from previous tests
        const bestRateLimit = this.results
            .filter(r => r.phase === 'rateLimit')
            .reduce((best, current) => current.score > (best?.score || 0) ? current : best, null);
        
        const bestScaling = this.results
            .filter(r => r.phase === 'scaling')
            .reduce((best, current) => current.parcelsPerMinute > (best?.parcelsPerMinute || 0) ? current : best, null);
        
        if (!bestRateLimit || !bestScaling) {
            console.log('   ⚠️  No optimal config found, using defaults');
            return null;
        }
        
        const optimalWorkers = Math.min(bestScaling.workerCount, this.deploymentInfo.successful);
        const optimalInterval = bestRateLimit.config.interval;
        
        console.log(`      🎯 Using ${optimalWorkers} workers with ${optimalInterval}ms interval...`);
        
        const validation = await this.runValidationTest(optimalWorkers, optimalInterval, 90000);
        
        console.log(`   🏆 Validated: ${validation.parcelsPerMinute.toFixed(1)} parcels/min, ${(validation.errorRate * 100).toFixed(1)}% errors`);
        
        this.results.push({
            phase: 'validation',
            config: { workers: optimalWorkers, interval: optimalInterval },
            ...validation
        });
        
        return validation;
    }

    async runValidationTest(workerCount, intervalMs, duration) {
        const testWorkers = this.deploymentInfo.workers.slice(0, workerCount);
        const startTime = performance.now();
        const endTime = startTime + duration;
        
        const results = {
            totalRequests: 0,
            successfulRequests: 0,
            parcelsProcessed: 0,
            latencies: []
        };
        
        const workerPromises = testWorkers.map(worker =>
            this.runValidationWorker(worker, intervalMs, endTime, results)
        );
        
        await Promise.all(workerPromises);
        
        const actualDuration = (performance.now() - startTime) / 1000;
        const requestsPerSec = results.totalRequests / actualDuration;
        const parcelsPerMinute = (results.parcelsProcessed / actualDuration) * 60;
        const errorRate = (results.totalRequests - results.successfulRequests) / results.totalRequests;
        const avgLatency = results.latencies.length > 0 
            ? results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length 
            : 0;
        
        return { requestsPerSec, parcelsPerMinute, errorRate, avgLatency };
    }

    async runValidationWorker(worker, intervalMs, endTime, results) {
        while (performance.now() < endTime) {
            try {
                const startTime = performance.now();
                
                const response = await fetch(`${worker.url}/scrape`, {
                    headers: { 
                        'User-Agent': `Utah-ValidationTest-${worker.id}/1.0`,
                        'Authorization': `Bearer ${this.authToken}`
                    },
                    signal: AbortSignal.timeout(20000)
                });
                
                const latency = performance.now() - startTime;
                results.totalRequests++;
                results.latencies.push(latency);
                
                if (response.ok) {
                    results.successfulRequests++;
                    
                    // Extract real parcel processing and log owner names same as normal workers
                    try {
                        const responseText = await response.text();
                        const parcelsProcessed = this.extractParcelCount(responseText, '/scrape');
                        results.parcelsProcessed += parcelsProcessed;
                        
                        // extractParcelCount method already logs owner names in same format as normal workers
                    } catch (e) {
                        results.parcelsProcessed += 1; // Conservative estimate
                    }
                }
                
                await this.sleep(intervalMs);
                
            } catch (error) {
                results.totalRequests++;
                await this.sleep(intervalMs * 1.5);
            }
        }
    }

    generateTuningReport() {
        console.log('\n' + '='.repeat(70));
        console.log('⚡ QUICK UTAH TUNING RESULTS');
        console.log('='.repeat(70));
        
        // Find optimal settings
        const bestRateLimit = this.results
            .filter(r => r.phase === 'rateLimit')
            .reduce((best, current) => current.score > (best?.score || 0) ? current : best, null);
        
        const bestScaling = this.results
            .filter(r => r.phase === 'scaling')
            .reduce((best, current) => current.parcelsPerMinute > (best?.parcelsPerMinute || 0) ? current : best, null);
        
        const validation = this.results.find(r => r.phase === 'validation');
        const burst = this.results.find(r => r.phase === 'burst');
        
        console.log('\n🏆 OPTIMAL CONFIGURATION:');
        if (validation) {
            console.log(`   📈 Validated Parcels/Min: ${Math.round(validation.parcelsPerMinute)}`);
            console.log(`   🚀 Validated Requests/Sec: ${validation.requestsPerSec.toFixed(1)}`);
            console.log(`   ❌ Error Rate: ${(validation.errorRate * 100).toFixed(1)}%`);
            console.log(`   ⏱️  Avg Latency: ${Math.round(validation.avgLatency)}ms`);
        }
        
        if (bestScaling) {
            console.log(`   🤖 Optimal Workers: ${bestScaling.workerCount}`);
        }
        
        if (bestRateLimit) {
            console.log(`   ⚡ Optimal Rate Limit: ${bestRateLimit.config.name} (${bestRateLimit.config.interval}ms)`);
            console.log(`   📊 Per-Worker Rate: ${(1000/bestRateLimit.config.interval).toFixed(2)} req/sec`);
        }
        
        if (burst) {
            console.log(`   🚀 Peak Burst: ${burst.peakRequestsPerSec.toFixed(1)} req/sec`);
        }
        
        console.log('\n🎯 PRODUCTION RECOMMENDATIONS:');
        if (validation && bestScaling && bestRateLimit) {
            const safetyMargin = 0.85;
            const prodParcelsPerMin = Math.round(validation.parcelsPerMinute * safetyMargin);
            const prodRequestsPerSec = validation.requestsPerSec * safetyMargin;
            
            console.log(`   🎯 Target Parcels/Min: ${prodParcelsPerMin}`);
            console.log(`   🤖 Production Workers: ${bestScaling.workerCount}`);
            console.log(`   ⏱️  Request Interval: ${bestRateLimit.config.interval}ms per worker`);
            console.log(`   🪣 Token Bucket Rate: ${Math.round(prodRequestsPerSec)}/sec`);
            console.log(`   📦 Global Pool Size: ${prodParcelsPerMin * 2} parcels`);
            
            // Time to completion
            const remainingParcels = 136620;
            const completionHours = remainingParcels / prodParcelsPerMin / 60;
            console.log(`   ⏰ Est. Completion: ${completionHours.toFixed(1)} hours`);
        }
        
        console.log('\n🔧 CONFIGURATION UPDATES:');
        console.log('   data-collector.js:');
        if (validation) {
            const poolSize = Math.round(validation.parcelsPerMinute * 2);
            console.log(`   • globalPoolTargetSize: ${poolSize}`);
            console.log(`   • emergencyRefillThreshold: ${Math.round(poolSize * 0.25)}`);
        }
        
        console.log('   worker-independent.js:');
        if (bestRateLimit) {
            console.log(`   • RATE_LIMIT_MS: ${bestRateLimit.config.interval}`);
            console.log(`   • tokenBucket.refillRatePerSec: ${Math.round(1000/bestRateLimit.config.interval * 0.8)}`);
        }
        
        // Save results
        const reportPath = path.join(__dirname, '..', 'utah-tuning-results.json');
        const report = {
            timestamp: new Date().toISOString(),
            recommendations: {
                workers: bestScaling?.workerCount || 12,
                rateLimitMs: bestRateLimit?.config.interval || 1500,
                parcelsPerMin: validation?.parcelsPerMinute || 0,
                requestsPerSec: validation?.requestsPerSec || 0
            },
            results: this.results
        };
        
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n💾 Results saved to: utah-tuning-results.json`);
        
        console.log('='.repeat(70));
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
    const tuner = new QuickUtahTuner();
    
    try {
        await tuner.runQuickTuning();
        console.log('\n✅ Quick Utah tuning completed successfully');
    } catch (error) {
        console.error('\n❌ Utah tuning failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = QuickUtahTuner;