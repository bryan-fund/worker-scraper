#!/usr/bin/env node

/**
 * Performance Test: Maximum Independent Scraper Parcels/Minute
 * 
 * This script tests the maximum throughput of a single independent scraper worker
 * to determine optimal bounds for concurrent workers and rate limiting parameters.
 * 
 * Based on Context7 performance testing patterns for Cloudflare Workers.
 */

const { performance } = require('perf_hooks');

class IndependentScraperPerfTest {
    constructor() {
        this.results = {
            testStartTime: null,
            testEndTime: null,
            totalParcels: 0,
            successfulParcels: 0,
            failedParcels: 0,
            http520Errors: 0,
            avgLatencyMs: 0,
            maxLatencyMs: 0,
            minLatencyMs: Infinity,
            latencySamples: [],
            parcelsPerMinute: 0,
            requestsPerMinute: 0,
            errorRate: 0,
            utilizationPct: 0,
            memoryUsage: {
                start: null,
                peak: null,
                end: null
            },
            rateLimit: {
                tokenBucketCapacity: 240,
                refillRatePerSec: 60,
                currentConcurrency: 4,
                microDelayMs: 10
            },
            phases: []
        };
        
        this.testConfig = {
            durationMinutes: 5,  // Run test for 5 minutes
            rampUpMinutes: 1,    // Gradual ramp up over 1 minute
            targetConcurrency: [1, 2, 4, 8, 16], // Test different concurrency levels
            batchSizes: [1, 4, 8, 16, 32], // Test different batch sizes
            workerUrl: process.env.TEST_WORKER_URL || 'https://slc-scraper-alpha.your-subdomain.workers.dev',
            collectorUrl: process.env.COLLECTOR_URL || 'http://localhost:3000',
            authToken: process.env.COLLECTOR_TOKEN || 'your-secure-token-here'
        };
    }

    async runPerformanceTest() {
        console.log('🚀 Starting Independent Scraper Performance Test');
        console.log(`📊 Target Worker: ${this.testConfig.workerUrl}`);
        console.log(`⏱️  Test Duration: ${this.testConfig.durationMinutes} minutes`);
        console.log(`🔄 Concurrency Levels: ${this.testConfig.targetConcurrency.join(', ')}`);
        console.log(`📦 Batch Sizes: ${this.testConfig.batchSizes.join(', ')}`);
        
        this.results.testStartTime = performance.now();
        this.results.memoryUsage.start = process.memoryUsage();

        // Phase 1: Baseline single-threaded performance
        await this.runPhase('baseline', 1, 4, 60);
        
        // Phase 2: Test different concurrency levels
        for (const concurrency of this.testConfig.targetConcurrency) {
            await this.runPhase(`concurrency-${concurrency}`, concurrency, 4, 60);
        }
        
        // Phase 3: Test different batch sizes at optimal concurrency
        const optimalConcurrency = this.findOptimalConcurrency();
        for (const batchSize of this.testConfig.batchSizes) {
            await this.runPhase(`batch-${batchSize}`, optimalConcurrency, batchSize, 60);
        }
        
        // Phase 4: Maximum sustained throughput test
        const optimalBatch = this.findOptimalBatchSize();
        await this.runPhase('max-throughput', optimalConcurrency, optimalBatch, 180);

        this.results.testEndTime = performance.now();
        this.results.memoryUsage.end = process.memoryUsage();
        
        this.generateReport();
        return this.results;
    }

    async runPhase(phaseName, concurrency, batchSize, durationSeconds) {
        console.log(`\n🔄 Phase: ${phaseName} (concurrency=${concurrency}, batch=${batchSize}, ${durationSeconds}s)`);
        
        const phaseResult = {
            name: phaseName,
            concurrency,
            batchSize,
            durationSeconds,
            startTime: performance.now(),
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            parcelsProcessed: 0,
            avgLatencyMs: 0,
            maxLatencyMs: 0,
            http520Count: 0,
            parcelsPerMinute: 0,
            requestsPerMinute: 0,
            errorRate: 0,
            utilizationPct: 0
        };

        const endTime = performance.now() + (durationSeconds * 1000);
        const workers = [];
        
        // Start concurrent workers
        for (let i = 0; i < concurrency; i++) {
            workers.push(this.runWorkerThread(i, batchSize, endTime, phaseResult));
        }

        await Promise.all(workers);
        
        phaseResult.endTime = performance.now();
        const phaseElapsedMin = (phaseResult.endTime - phaseResult.startTime) / (1000 * 60);
        
        phaseResult.parcelsPerMinute = phaseResult.parcelsProcessed / phaseElapsedMin;
        phaseResult.requestsPerMinute = phaseResult.totalRequests / phaseElapsedMin;
        phaseResult.errorRate = phaseResult.failedRequests / phaseResult.totalRequests;
        
        // Calculate theoretical max based on token bucket
        const theoreticalMax = this.results.rateLimit.refillRatePerSec * 60 * concurrency;
        phaseResult.utilizationPct = (phaseResult.parcelsPerMinute / theoreticalMax) * 100;
        
        this.results.phases.push(phaseResult);
        
        console.log(`✅ Phase ${phaseName} complete:`);
        console.log(`   📈 Parcels/min: ${Math.round(phaseResult.parcelsPerMinute)}`);
        console.log(`   🎯 Requests/min: ${Math.round(phaseResult.requestsPerMinute)}`);
        console.log(`   ⚡ Utilization: ${phaseResult.utilizationPct.toFixed(1)}%`);
        console.log(`   ❌ Error Rate: ${(phaseResult.errorRate * 100).toFixed(2)}%`);
        console.log(`   ⏱️  Avg Latency: ${Math.round(phaseResult.avgLatencyMs)}ms`);
    }

    async runWorkerThread(workerId, batchSize, endTime, phaseResult) {
        const latencySamples = [];
        let tokenBucket = this.results.rateLimit.tokenBucketCapacity;
        let lastRefill = performance.now();
        
        while (performance.now() < endTime) {
            // Token bucket rate limiting simulation
            const now = performance.now();
            const timeDelta = (now - lastRefill) / 1000;
            tokenBucket = Math.min(
                this.results.rateLimit.tokenBucketCapacity,
                tokenBucket + (this.results.rateLimit.refillRatePerSec * timeDelta)
            );
            lastRefill = now;
            
            if (tokenBucket < batchSize) {
                // Wait for tokens to refill
                await this.sleep(100);
                continue;
            }
            
            tokenBucket -= batchSize;
            
            try {
                const requestStart = performance.now();
                
                // First, get parcels from the collector
                const parcels = await this.getAllocateParcels(workerId, batchSize);
                if (parcels.length === 0) {
                    console.log(`⚠️ Worker ${workerId}: No parcels available, ending test`);
                    break;
                }
                
                // Process parcels through the worker
                const result = await this.processParcels(parcels);
                
                const requestEnd = performance.now();
                const latency = requestEnd - requestStart;
                
                phaseResult.totalRequests++;
                latencySamples.push(latency);
                
                if (result.success) {
                    phaseResult.successfulRequests++;
                    phaseResult.parcelsProcessed += result.parcelsProcessed;
                } else {
                    phaseResult.failedRequests++;
                    if (result.status === 520) {
                        phaseResult.http520Count++;
                    }
                }
                
                // Update peak memory usage
                const currentMemory = process.memoryUsage();
                if (!this.results.memoryUsage.peak || 
                    currentMemory.heapUsed > this.results.memoryUsage.peak.heapUsed) {
                    this.results.memoryUsage.peak = currentMemory;
                }
                
                // Apply micro-delay for rate limiting
                await this.sleep(this.results.rateLimit.microDelayMs);
                
            } catch (error) {
                phaseResult.failedRequests++;
                phaseResult.totalRequests++;
                console.error(`❌ Worker ${workerId} error:`, error.message);
            }
        }
        
        // Calculate worker-specific metrics
        if (latencySamples.length > 0) {
            const avgLatency = latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length;
            const maxLatency = Math.max(...latencySamples);
            
            phaseResult.avgLatencyMs = avgLatency;
            phaseResult.maxLatencyMs = Math.max(phaseResult.maxLatencyMs, maxLatency);
            
            // Add to global latency samples (limited to prevent memory bloat)
            this.results.latencySamples.push(...latencySamples.slice(-100));
        }
    }

    async getAllocateParcels(workerId, count) {
        try {
            const response = await fetch(
                `${this.testConfig.collectorUrl}/global-allocate/perf-test-${workerId}/${count}`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.testConfig.authToken}`,
                        'User-Agent': 'Performance-Test/1.0'
                    }
                }
            );
            
            if (!response.ok) {
                throw new Error(`Allocation failed: ${response.status}`);
            }
            
            const data = await response.json();
            return data.parcel_ids || [];
            
        } catch (error) {
            console.error(`❌ Allocation error for worker ${workerId}:`, error.message);
            return [];
        }
    }

    async processParcels(parcelIds) {
        try {
            // Simulate worker processing by making request to test worker
            const response = await fetch(this.testConfig.workerUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Performance-Test/1.0'
                },
                body: JSON.stringify({
                    parcel_ids: parcelIds,
                    test_mode: true  // Signal to worker this is a performance test
                })
            });
            
            if (!response.ok) {
                return {
                    success: false,
                    status: response.status,
                    parcelsProcessed: 0
                };
            }
            
            const result = await response.json();
            
            return {
                success: true,
                status: response.status,
                parcelsProcessed: result.successful || parcelIds.length
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message,
                parcelsProcessed: 0
            };
        }
    }

    findOptimalConcurrency() {
        let maxThroughput = 0;
        let optimalConcurrency = 4;
        
        for (const phase of this.results.phases) {
            if (phase.name.startsWith('concurrency-') && 
                phase.parcelsPerMinute > maxThroughput && 
                phase.errorRate < 0.05) { // Less than 5% error rate
                maxThroughput = phase.parcelsPerMinute;
                optimalConcurrency = phase.concurrency;
            }
        }
        
        return optimalConcurrency;
    }

    findOptimalBatchSize() {
        let maxThroughput = 0;
        let optimalBatch = 4;
        
        for (const phase of this.results.phases) {
            if (phase.name.startsWith('batch-') && 
                phase.parcelsPerMinute > maxThroughput && 
                phase.errorRate < 0.05) { // Less than 5% error rate
                maxThroughput = phase.parcelsPerMinute;
                optimalBatch = phase.batchSize;
            }
        }
        
        return optimalBatch;
    }

    generateReport() {
        console.log('\n' + '='.repeat(80));
        console.log('📊 INDEPENDENT SCRAPER PERFORMANCE TEST RESULTS');
        console.log('='.repeat(80));
        
        const totalElapsedMin = (this.results.testEndTime - this.results.testStartTime) / (1000 * 60);
        const maxThroughputPhase = this.results.phases.reduce((max, phase) => 
            phase.parcelsPerMinute > max.parcelsPerMinute ? phase : max, 
            this.results.phases[0]
        );
        
        console.log(`\n🎯 MAXIMUM PERFORMANCE ACHIEVED:`);
        console.log(`   📈 Peak Parcels/Minute: ${Math.round(maxThroughputPhase.parcelsPerMinute)}`);
        console.log(`   ⚙️  Optimal Concurrency: ${maxThroughputPhase.concurrency}`);
        console.log(`   📦 Optimal Batch Size: ${maxThroughputPhase.batchSize}`);
        console.log(`   ⚡ Peak Utilization: ${maxThroughputPhase.utilizationPct.toFixed(1)}%`);
        console.log(`   ❌ Error Rate: ${(maxThroughputPhase.errorRate * 100).toFixed(2)}%`);
        console.log(`   ⏱️  Average Latency: ${Math.round(maxThroughputPhase.avgLatencyMs)}ms`);
        
        console.log(`\n💾 MEMORY USAGE:`);
        console.log(`   📊 Start: ${Math.round(this.results.memoryUsage.start.heapUsed / 1024 / 1024)}MB`);
        console.log(`   📈 Peak: ${Math.round(this.results.memoryUsage.peak.heapUsed / 1024 / 1024)}MB`);
        console.log(`   📊 End: ${Math.round(this.results.memoryUsage.end.heapUsed / 1024 / 1024)}MB`);
        
        console.log(`\n📋 RECOMMENDED BOUNDS FOR PRODUCTION:`);
        const recommendedConcurrency = Math.min(maxThroughputPhase.concurrency, 8); // Cap at 8 for safety
        const recommendedBatch = Math.min(maxThroughputPhase.batchSize, 16); // Cap at 16 for safety
        const safetyFactor = 0.8; // 80% of max for safety margin
        const recommendedParcelsPerMin = Math.round(maxThroughputPhase.parcelsPerMinute * safetyFactor);
        
        console.log(`   🎯 Recommended Concurrency: ${recommendedConcurrency}`);
        console.log(`   📦 Recommended Batch Size: ${recommendedBatch}`);
        console.log(`   📈 Safe Parcels/Min Target: ${recommendedParcelsPerMin}`);
        console.log(`   ⏱️  Token Refill Rate: ${Math.round(recommendedParcelsPerMin / 60)}/sec`);
        console.log(`   🪣 Token Bucket Capacity: ${Math.round(recommendedParcelsPerMin / 60 * 4)}`); // 4x refill rate
        
        console.log(`\n📊 PHASE BREAKDOWN:`);
        for (const phase of this.results.phases) {
            console.log(`   ${phase.name.padEnd(20)} | ${Math.round(phase.parcelsPerMinute).toString().padStart(6)} ppm | ` +
                       `${phase.concurrency.toString().padStart(3)}c | ${phase.batchSize.toString().padStart(3)}b | ` +
                       `${phase.utilizationPct.toFixed(1).padStart(5)}% | ` +
                       `${(phase.errorRate * 100).toFixed(2).padStart(5)}% err`);
        }
        
        // Generate JSON report for programmatic use
        const jsonReport = {
            timestamp: new Date().toISOString(),
            testDurationMinutes: totalElapsedMin,
            maxPerformance: {
                parcelsPerMinute: maxThroughputPhase.parcelsPerMinute,
                optimalConcurrency: maxThroughputPhase.concurrency,
                optimalBatchSize: maxThroughputPhase.batchSize,
                utilizationPct: maxThroughputPhase.utilizationPct,
                errorRate: maxThroughputPhase.errorRate,
                avgLatencyMs: maxThroughputPhase.avgLatencyMs
            },
            recommendations: {
                concurrency: recommendedConcurrency,
                batchSize: recommendedBatch,
                targetParcelsPerMin: recommendedParcelsPerMin,
                tokenRefillRatePerSec: Math.round(recommendedParcelsPerMin / 60),
                tokenBucketCapacity: Math.round(recommendedParcelsPerMin / 60 * 4)
            },
            phases: this.results.phases,
            memoryUsage: this.results.memoryUsage
        };
        
        require('fs').writeFileSync(
            `perf-test-results-${Date.now()}.json`, 
            JSON.stringify(jsonReport, null, 2)
        );
        
        console.log(`\n💾 Detailed results saved to: perf-test-results-${Date.now()}.json`);
        console.log('='.repeat(80));
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Main execution
async function main() {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        console.log(`
Independent Scraper Performance Test

Usage: node perf-test.js [options]

Environment Variables:
  TEST_WORKER_URL     - URL of the worker to test (default: slc-scraper-alpha.your-subdomain.workers.dev)
  COLLECTOR_URL       - URL of the data collector (default: http://localhost:3000)
  COLLECTOR_TOKEN     - Auth token for collector (default: your-secure-token-here)

Options:
  --help, -h         - Show this help message

Example:
  TEST_WORKER_URL=https://my-worker.workers.dev COLLECTOR_TOKEN=abc123 node perf-test.js
        `);
        process.exit(0);
    }
    
    const tester = new IndependentScraperPerfTest();
    
    try {
        await tester.runPerformanceTest();
        console.log('\n✅ Performance test completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Performance test failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = IndependentScraperPerfTest;