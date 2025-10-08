#!/usr/bin/env node

/**
 * Utah Parcel Performance Benchmark
 * 
 * This script benchmarks the deployed Cloudflare Workers against the real
 * Salt Lake County parcel system to determine maximum sustainable throughput
 * and optimal configuration parameters.
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

class UtahParcelBenchmark {
    constructor() {
        this.deploymentInfo = this.loadDeploymentInfo();
        this.config = {
            // Benchmark phases - progressively increase load
            phases: [
                { name: 'Baseline Single', workers: 1, duration: 60, requestsPerSec: 0.5 },
                { name: 'Low Load', workers: 4, duration: 90, requestsPerSec: 2 },
                { name: 'Medium Load', workers: 8, duration: 120, requestsPerSec: 4 },
                { name: 'High Load', workers: 12, duration: 150, requestsPerSec: 8 },
                { name: 'Stress Test', workers: 16, duration: 180, requestsPerSec: 16 },
                { name: 'Maximum Load', workers: 20, duration: 300, requestsPerSec: 32 }
            ],
            // Rate limiting test configurations
            rateLimitTests: [
                { name: 'Conservative', requestInterval: 5000 }, // 0.2 req/sec per worker
                { name: 'Moderate', requestInterval: 3000 },     // 0.33 req/sec per worker
                { name: 'Aggressive', requestInterval: 2000 },   // 0.5 req/sec per worker
                { name: 'Burst', requestInterval: 1000 },        // 1 req/sec per worker
                { name: 'Maximum', requestInterval: 500 }        // 2 req/sec per worker
            ],
            endpoints: ['/scrape', '/batch', '/status'],
            maxConcurrentRequests: 50
        };
        this.results = [];
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            parcelsProcessed: 0,
            avgLatency: 0,
            p95Latency: 0,
            errorRate: 0,
            requestsPerSecond: 0,
            parcelsPerMinute: 0,
            rateLimitErrors: 0,
            http520Errors: 0,
            timeoutErrors: 0
        };
    }

    loadDeploymentInfo() {
        try {
            const deploymentPath = path.join(__dirname, '..', 'deployment-independent.json');
            const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
            console.log(`📋 Loaded ${deploymentData.successful} deployed workers for benchmarking`);
            return deploymentData;
        } catch (error) {
            console.error('❌ Could not load deployment info:', error.message);
            process.exit(1);
        }
    }

    async runComprehensiveBenchmark() {
        console.log('🔥 UTAH PARCEL PERFORMANCE BENCHMARK');
        console.log('=====================================');
        console.log(`🎯 Testing real SLC website performance`);
        console.log(`🤖 ${this.deploymentInfo.successful} workers available`);
        console.log(`⏱️  Total estimated time: ${this.calculateTotalTestTime()} minutes`);
        
        // Phase 1: Worker Health and Baseline
        console.log('\n🏥 Phase 1: Health Check & Baseline Performance');
        await this.runHealthCheck();
        
        // Phase 2: Rate Limiting Optimization
        console.log('\n⚡ Phase 2: Rate Limiting Optimization');
        await this.runRateLimitingTests();
        
        // Phase 3: Load Testing with Progressive Scaling
        console.log('\n📈 Phase 3: Progressive Load Testing');
        await this.runLoadTests();
        
        // Phase 4: Endpoint-Specific Performance
        console.log('\n🎯 Phase 4: Endpoint Performance Analysis');
        await this.runEndpointTests();
        
        // Phase 5: Maximum Throughput Discovery
        console.log('\n🚀 Phase 5: Maximum Throughput Discovery');
        await this.runMaxThroughputTest();
        
        this.generateComprehensiveReport();
    }

    async runHealthCheck() {
        console.log('   🔍 Testing worker responsiveness and Utah website connectivity...');
        
        const healthResults = [];
        const testWorkers = this.deploymentInfo.workers.slice(0, 5); // Test first 5 workers
        
        for (const worker of testWorkers) {
            try {
                const startTime = performance.now();
                
                // Test basic connectivity
                const response = await fetch(worker.url, {
                    headers: { 'User-Agent': 'Utah-Benchmark/1.0' },
                    signal: AbortSignal.timeout(10000)
                });
                
                const responseTime = performance.now() - startTime;
                const isHealthy = response.ok;
                
                // Test status endpoint for detailed metrics
                let statusInfo = null;
                try {
                    const statusResponse = await fetch(`${worker.url}/status`, {
                        headers: { 'User-Agent': 'Utah-Benchmark/1.0' },
                        signal: AbortSignal.timeout(5000)
                    });
                    if (statusResponse.ok) {
                        statusInfo = await statusResponse.text();
                    }
                } catch (e) {
                    // Status check failed, but main worker might still be working
                }
                
                healthResults.push({
                    workerId: worker.id,
                    healthy: isHealthy,
                    responseTime: Math.round(responseTime),
                    status: response.status,
                    hasStatus: !!statusInfo,
                    autonomousLoop: statusInfo ? statusInfo.includes('autonomous') : false
                });
                
                console.log(`   ${isHealthy ? '✅' : '❌'} ${worker.id}: ${Math.round(responseTime)}ms (${response.status})`);
                
            } catch (error) {
                console.log(`   ❌ ${worker.id}: ${error.message}`);
                healthResults.push({
                    workerId: worker.id,
                    healthy: false,
                    error: error.message
                });
            }
        }
        
        const healthyCount = healthResults.filter(r => r.healthy).length;
        console.log(`   📊 Health Summary: ${healthyCount}/${testWorkers.length} workers healthy`);
        
        if (healthyCount < testWorkers.length * 0.8) {
            console.warn('   ⚠️  Less than 80% workers healthy - consider checking deployment');
        }
        
        this.results.push({ phase: 'health', results: healthResults, healthyCount });
    }

    async runRateLimitingTests() {
        console.log('   🔄 Testing different rate limiting strategies...');
        
        for (const rateConfig of this.config.rateLimitTests) {
            console.log(`   📊 Testing ${rateConfig.name} rate (${1000/rateConfig.requestInterval} req/sec per worker)`);
            
            const testResult = await this.runRateLimitTest(rateConfig);
            this.results.push({
                phase: 'rateLimit',
                config: rateConfig,
                ...testResult
            });
            
            // Cool down between rate tests
            await this.sleep(10000);
        }
    }

    async runRateLimitTest(rateConfig) {
        const testWorkers = this.deploymentInfo.workers.slice(0, 8); // Use 8 workers for rate testing
        const testDuration = 90000; // 90 seconds
        const startTime = performance.now();
        const endTime = startTime + testDuration;
        
        const results = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            rateLimitErrors: 0,
            avgLatency: 0,
            latencies: [],
            errorTypes: {}
        };
        
        // Start workers with specified rate
        const workerPromises = testWorkers.map(worker => 
            this.runRateLimitedWorker(worker, rateConfig.requestInterval, endTime, results)
        );
        
        await Promise.all(workerPromises);
        
        const actualDuration = (performance.now() - startTime) / 1000;
        results.requestsPerSecond = results.totalRequests / actualDuration;
        results.errorRate = results.failedRequests / results.totalRequests;
        results.avgLatency = results.latencies.length > 0 ? 
            results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length : 0;
        
        // Calculate P95 latency
        if (results.latencies.length > 0) {
            results.latencies.sort((a, b) => a - b);
            const p95Index = Math.floor(results.latencies.length * 0.95);
            results.p95Latency = results.latencies[p95Index];
        }
        
        console.log(`      ✅ Req/Sec: ${results.requestsPerSecond.toFixed(2)}, Errors: ${(results.errorRate * 100).toFixed(1)}%, P95: ${Math.round(results.p95Latency)}ms`);
        
        return results;
    }

    async runRateLimitedWorker(worker, intervalMs, endTime, results) {
        while (performance.now() < endTime) {
            try {
                const requestStart = performance.now();
                
                const response = await fetch(`${worker.url}/scrape`, {
                    method: 'GET',
                    headers: {
                        'User-Agent': `Utah-Benchmark-${worker.id}/1.0`,
                        'X-Test-Rate': intervalMs.toString()
                    },
                    signal: AbortSignal.timeout(30000)
                });
                
                const latency = performance.now() - requestStart;
                results.totalRequests++;
                results.latencies.push(latency);
                
                if (response.ok) {
                    results.successfulRequests++;
                } else {
                    results.failedRequests++;
                    
                    // Track specific error types
                    const errorType = `HTTP_${response.status}`;
                    results.errorTypes[errorType] = (results.errorTypes[errorType] || 0) + 1;
                    
                    if (response.status === 429) {
                        results.rateLimitErrors++;
                    }
                }
                
                // Wait for next request based on rate limit
                await this.sleep(intervalMs);
                
            } catch (error) {
                results.totalRequests++;
                results.failedRequests++;
                
                const errorType = error.name || 'UNKNOWN';
                results.errorTypes[errorType] = (results.errorTypes[errorType] || 0) + 1;
            }
        }
    }

    async runLoadTests() {
        for (const phase of this.config.phases) {
            if (phase.workers > this.deploymentInfo.successful) {
                console.log(`   ⚠️  Skipping ${phase.name} (needs ${phase.workers} workers, have ${this.deploymentInfo.successful})`);
                continue;
            }
            
            console.log(`   🚀 ${phase.name}: ${phase.workers} workers, ${phase.duration}s, target ${phase.requestsPerSec} req/sec`);
            
            const loadResult = await this.runLoadTest(phase);
            this.results.push({
                phase: 'load',
                config: phase,
                ...loadResult
            });
            
            // Analysis of this phase
            const efficiency = (loadResult.requestsPerSecond / phase.requestsPerSec) * 100;
            const status = efficiency > 90 ? '✅' : efficiency > 70 ? '⚠️' : '❌';
            console.log(`      ${status} Achieved: ${loadResult.requestsPerSecond.toFixed(1)} req/sec (${efficiency.toFixed(0)}% of target)`);
            
            // Cool down between load tests
            await this.sleep(15000);
        }
    }

    async runLoadTest(phase) {
        const testWorkers = this.deploymentInfo.workers.slice(0, phase.workers);
        const testDuration = phase.duration * 1000;
        const targetInterval = 1000 / (phase.requestsPerSec / phase.workers); // Distribute load across workers
        
        const startTime = performance.now();
        const endTime = startTime + testDuration;
        
        const results = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            parcelsProcessed: 0,
            latencies: [],
            errorTypes: {},
            workerStats: []
        };
        
        // Launch load test workers
        const workerPromises = testWorkers.map((worker, index) => 
            this.runLoadTestWorker(worker, targetInterval, endTime, results, index)
        );
        
        await Promise.all(workerPromises);
        
        // Calculate final metrics
        const actualDuration = (performance.now() - startTime) / 1000;
        results.requestsPerSecond = results.totalRequests / actualDuration;
        results.errorRate = results.failedRequests / results.totalRequests;
        results.parcelsPerMinute = (results.parcelsProcessed / actualDuration) * 60;
        
        if (results.latencies.length > 0) {
            results.avgLatency = results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length;
            results.latencies.sort((a, b) => a - b);
            results.p95Latency = results.latencies[Math.floor(results.latencies.length * 0.95)];
            results.p99Latency = results.latencies[Math.floor(results.latencies.length * 0.99)];
        }
        
        return results;
    }

    async runLoadTestWorker(worker, intervalMs, endTime, results, workerIndex) {
        const workerStats = {
            workerId: worker.id,
            requests: 0,
            successes: 0,
            failures: 0,
            parcels: 0
        };
        
        while (performance.now() < endTime) {
            try {
                const requestStart = performance.now();
                
                // Alternate between scrape and batch endpoints for realistic load
                const endpoint = workerStats.requests % 3 === 0 ? '/batch' : '/scrape';
                
                const response = await fetch(`${worker.url}${endpoint}`, {
                    method: 'GET',
                    headers: {
                        'User-Agent': `Utah-LoadTest-${workerIndex}/1.0`,
                        'X-Worker-Index': workerIndex.toString(),
                        'X-Load-Test': 'true'
                    },
                    signal: AbortSignal.timeout(45000) // Longer timeout for real scraping
                });
                
                const latency = performance.now() - requestStart;
                
                workerStats.requests++;
                results.totalRequests++;
                results.latencies.push(latency);
                
                if (response.ok) {
                    workerStats.successes++;
                    results.successfulRequests++;
                    
                    // Try to extract parcel count from response
                    try {
                        const responseText = await response.text();
                        const parcelsFound = this.extractParcelCount(responseText);
                        workerStats.parcels += parcelsFound;
                        results.parcelsProcessed += parcelsFound;
                    } catch (e) {
                        // Assume 1 parcel processed if can't parse response
                        workerStats.parcels += 1;
                        results.parcelsProcessed += 1;
                    }
                } else {
                    workerStats.failures++;
                    results.failedRequests++;
                    
                    const errorType = `HTTP_${response.status}`;
                    results.errorTypes[errorType] = (results.errorTypes[errorType] || 0) + 1;
                }
                
                // Adaptive interval based on response time
                const adaptiveInterval = Math.max(intervalMs, latency * 0.5);
                await this.sleep(adaptiveInterval);
                
            } catch (error) {
                workerStats.requests++;
                workerStats.failures++;
                results.totalRequests++;
                results.failedRequests++;
                
                const errorType = error.name || 'NETWORK_ERROR';
                results.errorTypes[errorType] = (results.errorTypes[errorType] || 0) + 1;
                
                // Back off on errors
                await this.sleep(intervalMs * 2);
            }
        }
        
        results.workerStats.push(workerStats);
    }

    async runEndpointTests() {
        console.log('   🎯 Testing individual endpoint performance...');
        
        for (const endpoint of this.config.endpoints) {
            console.log(`   📊 Testing ${endpoint} endpoint...`);
            
            const endpointResult = await this.runEndpointTest(endpoint);
            this.results.push({
                phase: 'endpoint',
                endpoint,
                ...endpointResult
            });
            
            await this.sleep(5000);
        }
    }

    async runEndpointTest(endpoint) {
        const testWorkers = this.deploymentInfo.workers.slice(0, 10);
        const testDuration = 60000; // 1 minute per endpoint
        const requestInterval = 2000; // 0.5 req/sec per worker
        
        const startTime = performance.now();
        const endTime = startTime + testDuration;
        
        const results = {
            totalRequests: 0,
            successfulRequests: 0,
            latencies: [],
            errorTypes: {}
        };
        
        const workerPromises = testWorkers.map(worker => 
            this.runEndpointTestWorker(worker, endpoint, requestInterval, endTime, results)
        );
        
        await Promise.all(workerPromises);
        
        const actualDuration = (performance.now() - startTime) / 1000;
        results.requestsPerSecond = results.totalRequests / actualDuration;
        results.errorRate = (results.totalRequests - results.successfulRequests) / results.totalRequests;
        
        if (results.latencies.length > 0) {
            results.avgLatency = results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length;
            results.latencies.sort((a, b) => a - b);
            results.p95Latency = results.latencies[Math.floor(results.latencies.length * 0.95)];
        }
        
        console.log(`      ✅ ${endpoint}: ${results.requestsPerSecond.toFixed(1)} req/sec, ${Math.round(results.avgLatency)}ms avg`);
        
        return results;
    }

    async runEndpointTestWorker(worker, endpoint, intervalMs, endTime, results) {
        while (performance.now() < endTime) {
            try {
                const requestStart = performance.now();
                
                const response = await fetch(`${worker.url}${endpoint}`, {
                    headers: { 'User-Agent': `Utah-EndpointTest/1.0` },
                    signal: AbortSignal.timeout(30000)
                });
                
                const latency = performance.now() - requestStart;
                results.totalRequests++;
                results.latencies.push(latency);
                
                if (response.ok) {
                    results.successfulRequests++;
                } else {
                    const errorType = `HTTP_${response.status}`;
                    results.errorTypes[errorType] = (results.errorTypes[errorType] || 0) + 1;
                }
                
                await this.sleep(intervalMs);
                
            } catch (error) {
                results.totalRequests++;
                const errorType = error.name || 'ERROR';
                results.errorTypes[errorType] = (results.errorTypes[errorType] || 0) + 1;
            }
        }
    }

    async runMaxThroughputTest() {
        console.log('   🚀 Discovering maximum sustainable throughput...');
        
        const maxThroughputResult = await this.findMaxThroughput();
        this.results.push({
            phase: 'maxThroughput',
            ...maxThroughputResult
        });
        
        console.log(`   ✅ Maximum sustainable: ${maxThroughputResult.maxRequestsPerSec.toFixed(1)} req/sec`);
    }

    async findMaxThroughput() {
        let currentLoad = 1; // Start with 1 req/sec
        let maxSustainableLoad = 0;
        let consecutiveFailures = 0;
        
        const results = {
            attempts: [],
            maxRequestsPerSec: 0,
            maxParcelsPerMinute: 0,
            optimalWorkerCount: 0
        };
        
        while (currentLoad <= 50 && consecutiveFailures < 3) {
            console.log(`      🔍 Testing ${currentLoad} req/sec...`);
            
            const testResult = await this.runThroughputTest(currentLoad);
            results.attempts.push({
                targetLoad: currentLoad,
                actualLoad: testResult.actualRequestsPerSec,
                errorRate: testResult.errorRate,
                avgLatency: testResult.avgLatency,
                sustainable: testResult.errorRate < 0.10 && testResult.avgLatency < 10000
            });
            
            if (testResult.errorRate < 0.10 && testResult.avgLatency < 10000) {
                // Test was successful
                maxSustainableLoad = currentLoad;
                results.maxRequestsPerSec = testResult.actualRequestsPerSec;
                results.maxParcelsPerMinute = testResult.parcelsPerMinute;
                results.optimalWorkerCount = testResult.workersUsed;
                consecutiveFailures = 0;
                
                // Increase load more aggressively if performance is good
                const efficiency = testResult.actualRequestsPerSec / currentLoad;
                if (efficiency > 0.9) {
                    currentLoad = Math.round(currentLoad * 1.5);
                } else {
                    currentLoad += 2;
                }
            } else {
                // Test failed
                consecutiveFailures++;
                console.log(`      ❌ Failed at ${currentLoad} req/sec (errors: ${(testResult.errorRate * 100).toFixed(1)}%)`);
                currentLoad = Math.max(1, currentLoad - 1); // Back off
            }
        }
        
        return results;
    }

    async runThroughputTest(targetRequestsPerSec) {
        const workersNeeded = Math.min(
            Math.ceil(targetRequestsPerSec / 2), // Max 2 req/sec per worker
            this.deploymentInfo.successful
        );
        
        const testWorkers = this.deploymentInfo.workers.slice(0, workersNeeded);
        const intervalPerWorker = 1000 / (targetRequestsPerSec / workersNeeded);
        const testDuration = 120000; // 2 minutes for throughput test
        
        const startTime = performance.now();
        const endTime = startTime + testDuration;
        
        const results = {
            totalRequests: 0,
            successfulRequests: 0,
            parcelsProcessed: 0,
            latencies: [],
            workersUsed: workersNeeded
        };
        
        const workerPromises = testWorkers.map(worker =>
            this.runThroughputTestWorker(worker, intervalPerWorker, endTime, results)
        );
        
        await Promise.all(workerPromises);
        
        const actualDuration = (performance.now() - startTime) / 1000;
        results.actualRequestsPerSec = results.totalRequests / actualDuration;
        results.errorRate = (results.totalRequests - results.successfulRequests) / results.totalRequests;
        results.parcelsPerMinute = (results.parcelsProcessed / actualDuration) * 60;
        
        if (results.latencies.length > 0) {
            results.avgLatency = results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length;
        }
        
        return results;
    }

    async runThroughputTestWorker(worker, intervalMs, endTime, results) {
        while (performance.now() < endTime) {
            try {
                const requestStart = performance.now();
                
                const response = await fetch(`${worker.url}/scrape`, {
                    headers: { 'User-Agent': 'Utah-ThroughputTest/1.0' },
                    signal: AbortSignal.timeout(30000)
                });
                
                const latency = performance.now() - requestStart;
                results.totalRequests++;
                results.latencies.push(latency);
                
                if (response.ok) {
                    results.successfulRequests++;
                    results.parcelsProcessed += 1; // Estimate
                }
                
                await this.sleep(intervalMs);
                
            } catch (error) {
                results.totalRequests++;
            }
        }
    }

    extractParcelCount(responseText) {
        // Try to extract actual parcel count from worker response
        const patterns = [
            /processed[^\d]*(\d+)/i,
            /parcels?[^\d]*(\d+)/i,
            /count[^\d]*(\d+)/i,
            /batch[^\d]*(\d+)/i
        ];
        
        for (const pattern of patterns) {
            const match = responseText.match(pattern);
            if (match) {
                return parseInt(match[1]);
            }
        }
        
        return 1; // Default assumption
    }

    calculateTotalTestTime() {
        const phaseTime = this.config.phases.reduce((total, phase) => total + phase.duration, 0);
        const rateLimitTime = this.config.rateLimitTests.length * 100; // 90s + 10s cooldown each
        const endpointTime = this.config.endpoints.length * 65; // 60s + 5s cooldown each
        const maxThroughputTime = 600; // Estimated 10 minutes
        const healthCheckTime = 60;
        
        return Math.round((phaseTime + rateLimitTime + endpointTime + maxThroughputTime + healthCheckTime) / 60);
    }

    generateComprehensiveReport() {
        console.log('\n' + '='.repeat(80));
        console.log('🔥 UTAH PARCEL BENCHMARK RESULTS');
        console.log('='.repeat(80));
        
        // Find optimal configurations
        const bestRateLimit = this.findBestRateLimit();
        const bestLoadTest = this.findBestLoadTest();
        const maxThroughput = this.results.find(r => r.phase === 'maxThroughput');
        
        console.log('\n🏆 OPTIMAL CONFIGURATION:');
        if (maxThroughput) {
            console.log(`   🚀 Maximum Requests/Sec: ${maxThroughput.maxRequestsPerSec.toFixed(1)}`);
            console.log(`   📈 Maximum Parcels/Min: ${Math.round(maxThroughput.maxParcelsPerMinute)}`);
            console.log(`   🤖 Optimal Workers: ${maxThroughput.optimalWorkerCount}`);
        }
        
        if (bestRateLimit) {
            console.log(`   ⚡ Best Rate Strategy: ${bestRateLimit.config.name}`);
            console.log(`   📊 Rate Limit: ${(1000/bestRateLimit.config.requestInterval).toFixed(1)} req/sec per worker`);
        }
        
        console.log('\n📊 PERFORMANCE SUMMARY:');
        
        // Rate limiting results
        console.log('\n   Rate Limiting Performance:');
        console.log('   Strategy     | Req/Sec | Error% | P95 Latency');
        console.log('   -------------|---------|--------|------------');
        
        this.results.filter(r => r.phase === 'rateLimit').forEach(result => {
            const line = `   ${result.config.name.padEnd(12)} | ` +
                        `${result.requestsPerSecond.toFixed(1).padStart(7)} | ` +
                        `${(result.errorRate * 100).toFixed(1).padStart(6)} | ` +
                        `${Math.round(result.p95Latency).toString().padStart(10)}ms`;
            console.log(line);
        });
        
        // Load testing results
        console.log('\n   Load Testing Performance:');
        console.log('   Phase            | Workers | Target R/S | Actual R/S | Parcels/Min | Error%');
        console.log('   -----------------|---------|------------|------------|-------------|--------');
        
        this.results.filter(r => r.phase === 'load').forEach(result => {
            const line = `   ${result.config.name.padEnd(16)} | ` +
                        `${result.config.workers.toString().padStart(7)} | ` +
                        `${result.config.requestsPerSec.toFixed(1).padStart(10)} | ` +
                        `${result.requestsPerSecond.toFixed(1).padStart(10)} | ` +
                        `${Math.round(result.parcelsPerMinute).toString().padStart(11)} | ` +
                        `${(result.errorRate * 100).toFixed(1).padStart(6)}%`;
            console.log(line);
        });
        
        // Production recommendations
        console.log('\n🎯 PRODUCTION RECOMMENDATIONS:');
        
        if (maxThroughput && maxThroughput.maxRequestsPerSec > 0) {
            const safetyMargin = 0.8;
            const prodRequestsPerSec = Math.round(maxThroughput.maxRequestsPerSec * safetyMargin);
            const prodParcelsPerMin = Math.round(maxThroughput.maxParcelsPerMinute * safetyMargin);
            const prodWorkers = Math.min(maxThroughput.optimalWorkerCount, 16);
            
            console.log(`   🤖 Production Workers: ${prodWorkers}`);
            console.log(`   📈 Target Requests/Sec: ${prodRequestsPerSec}`);
            console.log(`   📊 Target Parcels/Min: ${prodParcelsPerMin}`);
            console.log(`   ⏱️  Request Interval: ${Math.round(1000 / (prodRequestsPerSec / prodWorkers))}ms per worker`);
            console.log(`   🪣 Token Bucket Rate: ${Math.round(prodRequestsPerSec / 60)}/sec`);
            console.log(`   📦 Global Pool Size: ${prodParcelsPerMin * 3} parcels (3min buffer)`);
            
            // Completion time estimate
            const remainingParcels = 136620;
            const completionMinutes = Math.round(remainingParcels / prodParcelsPerMin);
            console.log(`   ⏰ Estimated completion: ${completionMinutes} minutes (${Math.round(completionMinutes / 60)} hours)`);
        }
        
        // Configuration updates
        console.log('\n🔧 RECOMMENDED CONFIGURATION UPDATES:');
        console.log('   Update data-collector.js:');
        if (maxThroughput) {
            const globalPoolSize = Math.round(maxThroughput.maxParcelsPerMinute * 3);
            console.log(`   • globalPoolTargetSize: ${globalPoolSize}`);
            console.log(`   • emergencyRefillThreshold: ${Math.round(globalPoolSize * 0.3)}`);
        }
        
        if (bestRateLimit) {
            console.log(`   • RATE_LIMIT_MS: ${bestRateLimit.config.requestInterval}`);
        }
        
        console.log('\n   Update worker-independent.js:');
        if (bestLoadTest) {
            console.log(`   • dynamicBatchSize: ${Math.min(32, Math.round(bestLoadTest.parcelsPerMinute / 60))}`);
            console.log(`   • tokenBucket.refillRatePerSec: ${Math.round((maxThroughput?.maxRequestsPerSec || 10) * 0.8)}`);
        }
        
        // Save detailed report
        const reportPath = path.join(__dirname, '..', 'utah-benchmark-results.json');
        const detailedReport = {
            timestamp: new Date().toISOString(),
            testType: 'utah-parcel-benchmark',
            deployment: this.deploymentInfo,
            config: this.config,
            results: this.results,
            recommendations: {
                maxRequestsPerSec: maxThroughput?.maxRequestsPerSec || 0,
                maxParcelsPerMin: maxThroughput?.maxParcelsPerMinute || 0,
                optimalWorkers: maxThroughput?.optimalWorkerCount || 0,
                bestRateLimit: bestRateLimit?.config || null
            }
        };
        
        fs.writeFileSync(reportPath, JSON.stringify(detailedReport, null, 2));
        console.log(`\n💾 Detailed benchmark saved to: utah-benchmark-results.json`);
        
        console.log('='.repeat(80));
    }

    findBestRateLimit() {
        return this.results
            .filter(r => r.phase === 'rateLimit')
            .reduce((best, current) => {
                const currentScore = current.requestsPerSecond * (1 - current.errorRate) * (5000 / (current.p95Latency || 5000));
                const bestScore = best ? best.requestsPerSecond * (1 - best.errorRate) * (5000 / (best.p95Latency || 5000)) : 0;
                return currentScore > bestScore ? current : best;
            }, null);
    }

    findBestLoadTest() {
        return this.results
            .filter(r => r.phase === 'load')
            .reduce((best, current) => {
                return current.parcelsPerMinute > (best?.parcelsPerMinute || 0) && current.errorRate < 0.15 ? current : best;
            }, null);
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
    const benchmark = new UtahParcelBenchmark();
    
    try {
        await benchmark.runComprehensiveBenchmark();
        console.log('\n✅ Utah parcel benchmark completed successfully');
    } catch (error) {
        console.error('\n❌ Benchmark failed:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = UtahParcelBenchmark;