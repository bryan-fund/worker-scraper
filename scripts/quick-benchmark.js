#!/usr/bin/env node

/**
 * Quick Benchmark Script for Independent Scraper Performance
 * 
 * This script runs a quick local benchmark to test different worker configurations
 * and determine optimal settings for the independent scraper system.
 */

const http = require('http');
const { performance } = require('perf_hooks');

class QuickBenchmark {
    constructor() {
        this.config = {
            collectorUrl: process.env.COLLECTOR_URL || 'http://localhost:3000',
            authToken: process.env.COLLECTOR_TOKEN || 'your-secure-token-here',
            testDuration: 30, // seconds
            concurrencyLevels: [1, 2, 4, 8, 12, 16, 20],
            batchSizes: [1, 4, 8, 16, 32]
        };
        this.results = [];
    }

    async runQuickBenchmark() {
        console.log('⚡ Quick Independent Scraper Benchmark');
        console.log('=====================================');
        console.log(`🎯 Collector: ${this.config.collectorUrl}`);
        console.log(`⏱️  Duration: ${this.config.testDuration}s per test`);
        
        // Test global pool allocation performance
        console.log('\n📊 Testing Global Pool Allocation Performance...');
        await this.testGlobalPoolAllocation();
        
        // Test different concurrency levels
        console.log('\n🔄 Testing Concurrency Levels...');
        for (const concurrency of this.config.concurrencyLevels) {
            await this.testConcurrency(concurrency, 4); // Fixed batch size of 4
        }
        
        // Test different batch sizes at optimal concurrency
        const optimalConcurrency = this.findOptimalConcurrency();
        console.log(`\n📦 Testing Batch Sizes (concurrency=${optimalConcurrency})...`);
        for (const batchSize of this.config.batchSizes) {
            await this.testConcurrency(optimalConcurrency, batchSize);
        }
        
        this.generateQuickReport();
    }

    async testGlobalPoolAllocation() {
        console.log('   Testing global pool allocation speed...');
        const startTime = performance.now();
        let totalAllocations = 0;
        let successfulAllocations = 0;
        
        const endTime = performance.now() + (10 * 1000); // 10 second test
        
        while (performance.now() < endTime) {
            try {
                const response = await this.makeRequest(
                    `${this.config.collectorUrl}/global-allocate/benchmark-test/10`
                );
                totalAllocations++;
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.count > 0) {
                        successfulAllocations++;
                    }
                } 
            } catch (error) {
                // Count as failed allocation
            }
            
            // Small delay to avoid overwhelming
            await this.sleep(50);
        }
        
        const duration = (performance.now() - startTime) / 1000;
        const allocationsPerSec = totalAllocations / duration;
        
        console.log(`   ✅ Allocations/sec: ${allocationsPerSec.toFixed(1)}`);
        console.log(`   ✅ Success rate: ${((successfulAllocations / totalAllocations) * 100).toFixed(1)}%`);
        
        this.results.push({
            testType: 'allocation',
            allocationsPerSec,
            successRate: successfulAllocations / totalAllocations
        });
    }

    async testConcurrency(concurrency, batchSize) {
        console.log(`   Testing concurrency=${concurrency}, batch=${batchSize}...`);
        
        const result = {
            testType: 'concurrency',
            concurrency,
            batchSize,
            totalRequests: 0,
            successfulRequests: 0,
            totalParcels: 0,
            avgLatencyMs: 0,
            maxLatencyMs: 0,
            requestsPerSec: 0,
            parcelsPerMin: 0,
            errorRate: 0
        };
        
        const startTime = performance.now();
        const endTime = startTime + (this.config.testDuration * 1000);
        const workers = [];
        
        // Start concurrent workers
        for (let i = 0; i < concurrency; i++) {
            workers.push(this.runWorker(i, batchSize, endTime, result));
        }
        
        await Promise.all(workers);
        
        const duration = (performance.now() - startTime) / 1000;
        result.requestsPerSec = result.totalRequests / duration;
        result.parcelsPerMin = (result.totalParcels / duration) * 60;
        result.errorRate = (result.totalRequests - result.successfulRequests) / result.totalRequests;
        
        console.log(`   ✅ Parcels/min: ${Math.round(result.parcelsPerMin)}`);
        console.log(`   ✅ Requests/sec: ${result.requestsPerSec.toFixed(1)}`);
        console.log(`   ✅ Avg latency: ${Math.round(result.avgLatencyMs)}ms`);
        console.log(`   ✅ Error rate: ${(result.errorRate * 100).toFixed(1)}%`);
        
        this.results.push(result);
    }

    async runWorker(workerId, batchSize, endTime, result) {
        const latencies = [];
        
        while (performance.now() < endTime) {
            try {
                const requestStart = performance.now();
                
                // Get parcels from global pool
                const response = await this.makeRequest(
                    `${this.config.collectorUrl}/global-allocate/bench-${workerId}/${batchSize}`
                );
                
                result.totalRequests++;
                
                if (response.ok) {
                    const data = await response.json();
                    const parcelsReceived = data.count || 0;
                    
                    if (parcelsReceived > 0) {
                        result.successfulRequests++;
                        result.totalParcels += parcelsReceived;
                        
                        const latency = performance.now() - requestStart;
                        latencies.push(latency);
                    }
                    
                    // If no parcels available, break early
                    if (parcelsReceived === 0) {
                        console.log(`   ⚠️ Worker ${workerId}: No parcels available`);
                        break;
                    }
                }
                
                // Small delay to simulate processing
                await this.sleep(10);
                
            } catch (error) {
                result.totalRequests++;
                console.error(`   ❌ Worker ${workerId} error:`, error.message);
            }
        }
        
        // Update latency stats
        if (latencies.length > 0) {
            const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
            const maxLatency = Math.max(...latencies);
            
            result.avgLatencyMs = (result.avgLatencyMs + avgLatency) / 2; // Running average
            result.maxLatencyMs = Math.max(result.maxLatencyMs, maxLatency);
        }
    }

    async makeRequest(url) {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.config.authToken}`,
                'User-Agent': 'Quick-Benchmark/1.0'
            }
        });
        return response;
    }

    findOptimalConcurrency() {
        let maxThroughput = 0;
        let optimal = 4;
        
        for (const result of this.results) {
            if (result.testType === 'concurrency' && 
                result.batchSize === 4 && 
                result.parcelsPerMin > maxThroughput &&
                result.errorRate < 0.1) {
                maxThroughput = result.parcelsPerMin;
                optimal = result.concurrency;
            }
        }
        
        return optimal;
    }

    generateQuickReport() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 QUICK BENCHMARK RESULTS');
        console.log('='.repeat(60));
        
        // Find best performing configuration
        const concurrencyTests = this.results.filter(r => r.testType === 'concurrency');
        const bestTest = concurrencyTests.reduce((best, current) => {
            if (current.parcelsPerMin > best.parcelsPerMin && current.errorRate < 0.1) {
                return current;
            }
            return best;
        }, concurrencyTests[0]);
        
        console.log('\n🏆 OPTIMAL CONFIGURATION:');
        console.log(`   🎯 Concurrency: ${bestTest.concurrency}`);
        console.log(`   📦 Batch Size: ${bestTest.batchSize}`);
        console.log(`   📈 Max Parcels/Min: ${Math.round(bestTest.parcelsPerMin)}`);
        console.log(`   ⚡ Requests/Sec: ${bestTest.requestsPerSec.toFixed(1)}`);
        console.log(`   ⏱️  Avg Latency: ${Math.round(bestTest.avgLatencyMs)}ms`);
        console.log(`   ❌ Error Rate: ${(bestTest.errorRate * 100).toFixed(1)}%`);
        
        console.log('\n📈 RECOMMENDED SETTINGS:');
        const safetyMargin = 0.8;
        const recommendedParcelsPerMin = Math.round(bestTest.parcelsPerMin * safetyMargin);
        const recommendedConcurrency = Math.min(bestTest.concurrency, 16); // Cap for safety
        
        console.log(`   🎯 Production Concurrency: ${recommendedConcurrency}`);
        console.log(`   📦 Production Batch Size: ${bestTest.batchSize}`);
        console.log(`   📈 Target Parcels/Min: ${recommendedParcelsPerMin}`);
        console.log(`   ⏱️  Token Refill Rate: ${Math.round(recommendedParcelsPerMin / 60)}/sec`);
        console.log(`   🪣 Token Bucket Capacity: ${Math.round(recommendedParcelsPerMin / 60 * 3)}`);
        
        // Show allocation performance
        const allocTest = this.results.find(r => r.testType === 'allocation');
        if (allocTest) {
            console.log('\n🔄 ALLOCATION PERFORMANCE:');
            console.log(`   ⚡ Allocations/Sec: ${allocTest.allocationsPerSec.toFixed(1)}`);
            console.log(`   ✅ Success Rate: ${(allocTest.successRate * 100).toFixed(1)}%`);
        }
        
        console.log('\n📊 ALL TEST RESULTS:');
        console.log('   Concurrency | Batch | Parcels/Min | Req/Sec | Latency | Error%');
        console.log('   ------------|-------|-------------|---------|---------|--------');
        
        for (const result of concurrencyTests) {
            const line = `   ${result.concurrency.toString().padStart(10)} | ` +
                        `${result.batchSize.toString().padStart(5)} | ` +
                        `${Math.round(result.parcelsPerMin).toString().padStart(11)} | ` +
                        `${result.requestsPerSec.toFixed(1).padStart(7)} | ` +
                        `${Math.round(result.avgLatencyMs).toString().padStart(7)}ms | ` +
                        `${(result.errorRate * 100).toFixed(1).padStart(6)}%`;
            console.log(line);
        }
        
        console.log('\n💡 INTERPRETATION:');
        console.log('   • High parcels/min with low error rate indicates good performance');
        console.log('   • Watch for error rate increases at high concurrency levels');
        console.log('   • Latency should remain reasonable (< 1000ms) for good UX');
        console.log('   • Production settings should include 20% safety margin');
        
        console.log('\n🎯 NEXT STEPS:');
        console.log('   1. Deploy test worker with recommended settings');
        console.log('   2. Run full performance test with real workers');
        console.log('   3. Monitor production metrics and adjust as needed');
        console.log('   4. Consider global pool size based on max parcels/min × workers');
        
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
    const benchmark = new QuickBenchmark();
    
    try {
        await benchmark.runQuickBenchmark();
        console.log('\n✅ Quick benchmark completed successfully');
    } catch (error) {
        console.error('\n❌ Benchmark failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = QuickBenchmark;