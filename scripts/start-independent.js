#!/usr/bin/env node

/**
 * Start Independent Salt Lake County Property Scraping
 * Ultra-optimized version with advanced worker independence
 * Expected performance: 600+ parcels/minute
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Independent worker configurations with staggered timing for HTTP 520 prevention
const INDEPENDENT_WORKERS = [
  { id: 'slc-scraper-alpha', url: 'https://slc-scraper-alpha.w2ntsrpc5v.workers.dev', delay: 2000, offset: 0 },
  { id: 'slc-scraper-beta', url: 'https://slc-scraper-beta.w2ntsrpc5v.workers.dev', delay: 2200, offset: 100 },
  { id: 'slc-scraper-gamma', url: 'https://slc-scraper-gamma.w2ntsrpc5v.workers.dev', delay: 2100, offset: 200 },
  { id: 'slc-scraper-delta', url: 'https://slc-scraper-delta.w2ntsrpc5v.workers.dev', delay: 2400, offset: 300 },
  { id: 'slc-scraper-epsilon', url: 'https://slc-scraper-epsilon.w2ntsrpc5v.workers.dev', delay: 1900, offset: 400 },
  { id: 'slc-scraper-zeta', url: 'https://slc-scraper-zeta.w2ntsrpc5v.workers.dev', delay: 2300, offset: 500 },
  { id: 'slc-scraper-eta', url: 'https://slc-scraper-eta.w2ntsrpc5v.workers.dev', delay: 2000, offset: 600 },
  { id: 'slc-scraper-theta', url: 'https://slc-scraper-theta.w2ntsrpc5v.workers.dev', delay: 2200, offset: 700 },
  { id: 'slc-scraper-iota', url: 'https://slc-scraper-iota.w2ntsrpc5v.workers.dev', delay: 2100, offset: 800 },
  { id: 'slc-scraper-kappa', url: 'https://slc-scraper-kappa.w2ntsrpc5v.workers.dev', delay: 2500, offset: 900 },
  { id: 'slc-scraper-lambda', url: 'https://slc-scraper-lambda.w2ntsrpc5v.workers.dev', delay: 2350, offset: 1000 },
  { id: 'slc-scraper-mu', url: 'https://slc-scraper-mu.w2ntsrpc5v.workers.dev', delay: 2050, offset: 1100 },
  { id: 'slc-scraper-nu', url: 'https://slc-scraper-nu.w2ntsrpc5v.workers.dev', delay: 2250, offset: 1200 },
  { id: 'slc-scraper-xi', url: 'https://slc-scraper-xi.w2ntsrpc5v.workers.dev', delay: 2150, offset: 1300 },
  { id: 'slc-scraper-omicron', url: 'https://slc-scraper-omicron.w2ntsrpc5v.workers.dev', delay: 2450, offset: 1400 },
  { id: 'slc-scraper-pi', url: 'https://slc-scraper-pi.w2ntsrpc5v.workers.dev', delay: 1950, offset: 1500 },
  { id: 'slc-scraper-rho', url: 'https://slc-scraper-rho.w2ntsrpc5v.workers.dev', delay: 2300, offset: 1600 },
  { id: 'slc-scraper-sigma', url: 'https://slc-scraper-sigma.w2ntsrpc5v.workers.dev', delay: 2000, offset: 1700 },
  { id: 'slc-scraper-tau', url: 'https://slc-scraper-tau.w2ntsrpc5v.workers.dev', delay: 2400, offset: 1800 },
  { id: 'slc-scraper-upsilon', url: 'https://slc-scraper-upsilon.w2ntsrpc5v.workers.dev', delay: 2100, offset: 1900 }
];

const BATCH_SIZE = 4; // Smaller batches to reduce per-request latency and smooth load
const INTER_BATCH_DELAY = 1100; // More aggressive: ~1.1s between batches per worker
const WORKER_STARTUP_STAGGER = 900; // Faster startup staggering
const JITTER_MS = 250; // Random jitter to avoid request synchronization

class IndependentSaltLakeCountyScraper {
  constructor() {
    this.db = new sqlite3.Database('./salt_lake_county_lir_parcels.db');
    this.workers = INDEPENDENT_WORKERS;
    this.isRunning = false;
    this.stats = {
      startTime: new Date(),
      totalAssigned: 0,
      totalCompleted: 0,
      totalErrors: 0,
      ratePerMinute: 0
    };
    this.workerStats = new Map();
    this.workerParcels = new Map(); // Track parcels assigned to each worker
    this.workerBatchIndex = new Map(); // Track current batch index for each worker
  this.workerTimingWindows = new Map(); // Track recent batch timings for adaptive delay
  this.workerIdleTime = new Map(); // Track cumulative idle time
  this.workerActiveTime = new Map(); // Track cumulative active (batch) time
    
    // Initialize worker stats
    this.workers.forEach(worker => {
      this.workerStats.set(worker.id, {
        assigned: 0,
        completed: 0,
        errors: 0,
        lastBatch: null,
        status: 'ready',
        dynamicDelay: INTER_BATCH_DELAY // per-worker adaptive delay
      });
      this.workerParcels.set(worker.id, []);
      this.workerBatchIndex.set(worker.id, 0);
      this.workerTimingWindows.set(worker.id, []); // store last N batch metrics
      this.workerIdleTime.set(worker.id, 0);
      this.workerActiveTime.set(worker.id, 0);
    });
  }

  async start() {
    console.log('🚀 Starting Independent Salt Lake County Property Scraper');
    console.log('🔒 Enhanced Features: Browser Fingerprinting, IP Rotation, Anti-Detection');
    console.log('🔄 NEW: Dynamic Reallocation System - Failed parcels automatically redistributed');
    console.log(`⚡ Target Performance: 600+ parcels/minute (20 workers)`);
    console.log(`🤖 Independent Workers: ${this.workers.length}`);
    console.log(`📦 Batch Size: ${BATCH_SIZE}`);
    console.log(`⏱️  Inter-batch Delay: ${INTER_BATCH_DELAY}ms`);
    console.log(`🌍 Distributed Load: ~${Math.round(60000 / (INTER_BATCH_DELAY + 1200))} req/min per worker`);
    
    this.isRunning = true;
    this.stats.startTime = new Date();
    
    try {
      // Pre-partition parcels locally so we always have a fallback even if the
      // remote reallocation endpoint is warming up or returns empty early.
      // This prevents the early "No more parcels available" false-positive when
      // the collector server hasn't populated its in-memory pools yet.
      try {
        await this.partitionParcelsEvenly();
        console.log('✅ Local round-robin partition prepared as fallback source');
      } catch (e) {
        console.log('⚠️ Failed to pre-partition parcels (will rely solely on /reallocate):', e.message);
      }
      // Initialize empty worker assignments for reallocation system
      console.log('� Initializing dynamic reallocation system...');
      this.workers.forEach(worker => {
        this.workerParcels.set(worker.id, []);
        this.workerBatchIndex.set(worker.id, 0);
      });
      
      // Start workers with staggered timing for HTTP 520 prevention
      const workerPromises = this.workers.map((worker, index) => {
        const baseDelay = index * WORKER_STARTUP_STAGGER + worker.offset;
        const jitter = Math.floor(Math.random() * JITTER_MS);
        return this.startWorker(worker, baseDelay + jitter); // Stagger + jitter
      });
      
      // Start progress monitoring
      this.startProgressMonitoring();
      
      // Wait for all workers to complete
      await Promise.all(workerPromises);
      
      console.log('\n🎉 All independent workers completed successfully!');
      this.printFinalStats();
      
    } catch (error) {
      console.error('❌ Scraping failed:', error);
    } finally {
      this.isRunning = false;
      this.db.close();
    }
  }

  async partitionParcelsEvenly() {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT PARCEL_ID as parcel_id 
        FROM salt_lake_county_lir_parcels 
        WHERE PARCEL_ID NOT IN (
          SELECT DISTINCT parcel_id 
          FROM owner_data 
          WHERE parcel_id IS NOT NULL
        )
        ORDER BY PARCEL_ID
      `;
      
      this.db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        
        const allParcels = rows.map(row => row.parcel_id);
        const totalParcels = allParcels.length;
        const numWorkers = this.workers.length;
        
        console.log(`📊 Total unprocessed parcels: ${totalParcels.toLocaleString()}`);
        console.log(`👥 Number of workers: ${numWorkers}`);
        console.log(`⚖️  Parcels per worker: ~${Math.ceil(totalParcels / numWorkers)}`);
        console.log(`🚀 Estimated completion: ~${Math.round(totalParcels / (numWorkers * 60))} minutes at 1 parcel/sec/worker`);
        
        // Distribute parcels evenly using round-robin
        allParcels.forEach((parcelId, index) => {
          const workerIndex = index % numWorkers;
          const workerId = this.workers[workerIndex].id;
          this.workerParcels.get(workerId).push(parcelId);
        });
        
        // Log distribution
        console.log('\n📋 Parcel Distribution:');
        this.workers.forEach(worker => {
          const assignedCount = this.workerParcels.get(worker.id).length;
          console.log(`   🤖 ${worker.id}: ${assignedCount.toLocaleString()} parcels`);
        });
        
        resolve();
      });
    });
  }

  async startWorker(worker, initialDelay = 0) {
    // Initial delay for staggered start
    if (initialDelay > 0) {
      await this.sleep(initialDelay);
    }
    
    console.log(`🤖 Starting independent worker: ${worker.id}`);
    this.workerStats.get(worker.id).status = 'active';
    
    try {
      while (this.isRunning) {
        // Get next batch of parcels for this worker
        const parcelIds = await this.getNextBatch(worker.id);
        
        if (parcelIds.length === 0) {
          console.log(`✅ Worker ${worker.id}: No more parcels to process`);
          this.workerStats.get(worker.id).status = 'completed';
          break;
        }
        
        // Update stats
        this.workerStats.get(worker.id).assigned += parcelIds.length;
        this.stats.totalAssigned += parcelIds.length;
        
        // Process batch with this independent worker
        const result = await this.processBatch(worker, parcelIds);
        
        // Update completion stats
        this.workerStats.get(worker.id).completed += result.successful;
        this.workerStats.get(worker.id).errors += result.failed;
        this.stats.totalCompleted += result.successful;
        this.stats.totalErrors += result.failed;
        this.workerStats.get(worker.id).lastBatch = new Date();
        
        console.log(`⚡ Worker ${worker.id}: Processed ${result.successful}/${parcelIds.length} parcels`);
        
    // Dynamic delay based on worker configuration
    // Compute adaptive delay using per-worker dynamicDelay adjusted via recent performance
    const stats = this.workerStats.get(worker.id);
    const baseAdaptive = stats.dynamicDelay;
    const jitter = 80 + Math.random() * 140; // narrower jitter window
    const dynamicDelay = baseAdaptive + Math.floor(worker.delay * 0.12) + jitter; // slightly leaner multiplier
    console.log(`⏳ Idle ${worker.id}: sleeping ${Math.round(dynamicDelay)}ms (baseAdaptive=${baseAdaptive})`);
    await this.sleep(dynamicDelay);
    // Accumulate idle time
    this.workerIdleTime.set(worker.id, this.workerIdleTime.get(worker.id) + dynamicDelay);
      }
      
    } catch (error) {
      console.error(`❌ Worker ${worker.id} failed:`, error.message);
      this.workerStats.get(worker.id).status = 'failed';
    }
  }

  async getNextBatch(workerId) {
    // If using reallocation system, get parcels from server instead of pre-assigned list
    try {
      const response = await fetch(`http://localhost:3000/reallocate/${workerId}/${BATCH_SIZE}`, {
        headers: {
          'Authorization': 'Bearer your-secure-token-here',
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        console.log(`❌ Reallocation failed for ${workerId}, falling back to pre-assigned parcels`);
        return this.getNextBatchFallback(workerId);
      }
      
      const reallocationData = await response.json();
      
      if (reallocationData.count === 0) {
        // Instead of concluding exhaustion, attempt fallback batch from local partition.
        console.log(`⚠️ Worker ${workerId}: Reallocation empty (type=${reallocationData.type}); attempting local fallback batch`);
        const fb = await this.getNextBatchFallback(workerId);
        if (fb.length === 0) {
          // Try global allocate before giving up
          let globalAttempts = 0;
          const maxGlobalAttempts = 3;
          
          while (globalAttempts < maxGlobalAttempts) {
            try {
              const gaResp = await fetch(`http://localhost:3000/global-allocate/${workerId}/${BATCH_SIZE}`, {
                headers: { 'Authorization': 'Bearer your-secure-token-here' }
              });
              if (gaResp.ok) {
                const ga = await gaResp.json();
                if (ga.count > 0) {
                  console.log(`🌐 Worker ${workerId}: Pulled ${ga.count} parcels from global pool (attempt ${globalAttempts + 1})`);
                  return ga.parcel_ids;
                }
              }
            } catch(e) {
              console.log(`⚠️ Worker ${workerId}: Global allocate attempt ${globalAttempts + 1} failed: ${e.message}`);
            }
            
            globalAttempts++;
            if (globalAttempts < maxGlobalAttempts) {
              // Trigger manual pool refresh before retry
              try {
                await fetch(`http://localhost:3000/refresh-pool`);
                console.log(`🔄 Worker ${workerId}: Triggered pool refresh`);
              } catch(e) {
                // Continue even if refresh fails
              }
              console.log(`⏳ Worker ${workerId}: Waiting 5s before retry ${globalAttempts + 1}/${maxGlobalAttempts}...`);
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          }
          
          console.log(`✅ Worker ${workerId}: No more parcels available after ${maxGlobalAttempts} attempts`);
          return [];
        }
        return fb;
      }
      
      console.log(`🔄 Worker ${workerId}: Got ${reallocationData.count} parcels (${reallocationData.type})`);
      return reallocationData.parcel_ids;
      
    } catch (error) {
      console.error(`❌ Reallocation error for ${workerId}:`, error.message);
      return this.getNextBatchFallback(workerId);
    }
  }

  async getNextBatchFallback(workerId) {
    // Fallback to original pre-assigned system
    const workerParcels = this.workerParcels.get(workerId);
    const currentIndex = this.workerBatchIndex.get(workerId);
    
    if (!workerParcels || currentIndex >= workerParcels.length) {
      return []; // No more parcels for this worker
    }
    
    // Get the next batch of parcels for this specific worker
    const endIndex = Math.min(currentIndex + BATCH_SIZE, workerParcels.length);
    const batch = workerParcels.slice(currentIndex, endIndex);
    
    // Update the batch index for next time
    this.workerBatchIndex.set(workerId, endIndex);
    
    return batch;
  }

  async processBatch(worker, parcelIds) {
    try {
      const batchStart = Date.now();
      const requestBody = {
        parcel_ids: parcelIds,
        worker_id: worker.id,
        delay: worker.delay
      };
      
      console.log(`🔍 DEBUG ${worker.id}: Sending request with ${parcelIds.length} parcels`);
      
      const response = await fetch(`${worker.url}/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `IndependentScraper/${worker.id}/2.0`
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
  const batchDuration = Date.now() - batchStart;
  this.workerActiveTime.set(worker.id, this.workerActiveTime.get(worker.id) + batchDuration);
      const perParcel = parcelIds.length ? (batchDuration / parcelIds.length) : null;
      console.log(`🔍 DEBUG ${worker.id}: Got response - successful: ${result.successful}, failed: ${result.failed} | ${batchDuration}ms total (${perParcel ? perParcel.toFixed(1) : 'n/a'} ms/parcel)`);

      // Update timing window
      const window = this.workerTimingWindows.get(worker.id);
      window.push({ ts: Date.now(), batchDuration, perParcel, successRate: parcelIds.length ? (result.successful / parcelIds.length) : 0 });
      if (window.length > 8) window.shift(); // keep last 8 batches (~recent history)

      // Adaptive delay adjustment logic
      const stats = this.workerStats.get(worker.id);
      const avgPerParcel = window.filter(w => w.perParcel !== null).reduce((a, b) => a + b.perParcel, 0) / Math.max(1, window.filter(w => w.perParcel !== null).length);
      const avgSuccess = window.reduce((a, b) => a + b.successRate, 0) / window.length;

      let newDelay = stats.dynamicDelay;
      const MIN_DELAY = 600; // floor for adaptive delay
      const MAX_DELAY = 2500; // ceiling safeguard

      if (window.length >= 4) { // Only adjust after initial warm-up
        if (avgSuccess > 0.95 && avgPerParcel < 450) {
          // Performance good: decay delay by 8%
            const old = newDelay;
            newDelay = Math.max(MIN_DELAY, Math.round(newDelay * 0.92));
            if (newDelay !== old) {
              console.log(`📉 Adaptive delay decay for ${worker.id}: ${old}ms -> ${newDelay}ms (avgPerParcel=${avgPerParcel.toFixed(1)}ms, success=${(avgSuccess*100).toFixed(1)}%)`);
            }
        } else if (avgSuccess < 0.80 || (avgPerParcel && avgPerParcel > 900)) {
          // Under strain: increase delay by 18%
            const old = newDelay;
            newDelay = Math.min(MAX_DELAY, Math.round(newDelay * 1.18 + 40));
            if (newDelay !== old) {
              console.log(`🔺 Adaptive delay increase for ${worker.id}: ${old}ms -> ${newDelay}ms (avgPerParcel=${avgPerParcel ? avgPerParcel.toFixed(1):'n/a'}ms, success=${(avgSuccess*100).toFixed(1)}%)`);
            }
        }
      }
      stats.dynamicDelay = newDelay;
      return result;
      
    } catch (error) {
      console.error(`❌ Batch processing failed for ${worker.id}:`, error.message);
      return { successful: 0, failed: parcelIds.length };
    }
  }

  startProgressMonitoring() {
    const interval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(interval);
        return;
      }
      
      this.updateRateCalculation();
      this.printProgressUpdate();
    }, 10000); // Update every 10 seconds
  }

  updateRateCalculation() {
    const elapsed = (new Date() - this.stats.startTime) / 1000 / 60; // minutes
    this.stats.ratePerMinute = elapsed > 0 ? Math.round(this.stats.totalCompleted / elapsed) : 0;
    
    // Memory monitoring for 50 workers
    if (this.stats.totalCompleted > 0 && this.stats.totalCompleted % 500 === 0) {
      const memUsage = process.memoryUsage();
      console.log(`💾 Memory Usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB heap, ${Math.round(memUsage.rss / 1024 / 1024)}MB RSS`);
    }
  }

  printProgressUpdate() {
    console.log('\n📊 INDEPENDENT SCRAPER PROGRESS');
    console.log('================================');
    console.log(`⚡ Current Rate: ${this.stats.ratePerMinute} parcels/minute`);
    console.log(`✅ Completed: ${this.stats.totalCompleted.toLocaleString()}`);
    console.log(`❌ Errors: ${this.stats.totalErrors.toLocaleString()}`);
    console.log(`🕐 Runtime: ${Math.round((new Date() - this.stats.startTime) / 1000 / 60)} minutes`);
    
    console.log('\n🤖 Independent Worker Status (Even Distribution):');
    this.workers.forEach(worker => {
      const stats = this.workerStats.get(worker.id);
      const totalAssigned = this.workerParcels.get(worker.id).length;
      const currentIndex = this.workerBatchIndex.get(worker.id);
      const remaining = totalAssigned - currentIndex;
      const status = stats.status === 'active' ? '🟢' : stats.status === 'completed' ? '✅' : '❌';
      const progress = totalAssigned > 0 ? Math.round((stats.completed / totalAssigned) * 100) : 0;
      const timingWindow = this.workerTimingWindows.get(worker.id);
      const avgPerParcel = timingWindow.length ? (timingWindow.filter(w=>w.perParcel).reduce((a,b)=>a+b.perParcel,0) / Math.max(1,timingWindow.filter(w=>w.perParcel).length)) : null;
      const idle = this.workerIdleTime.get(worker.id) || 0;
      const active = this.workerActiveTime.get(worker.id) || 0;
      const utilization = (active + idle) > 0 ? (active / (active + idle) * 100) : 0;
      console.log(`   ${status} ${worker.id}: ${stats.completed}/${totalAssigned} (${progress}%) | rem ${remaining} | err ${stats.errors} | avg ${avgPerParcel?avgPerParcel.toFixed(0)+'ms':''} | util ${utilization.toFixed(1)}% | dynDelay ${stats.dynamicDelay}ms`);
    });
  }

  printFinalStats() {
    const totalTime = (new Date() - this.stats.startTime) / 1000 / 60;
    const finalRate = totalTime > 0 ? Math.round(this.stats.totalCompleted / totalTime) : 0;
    
    console.log('\n🏁 INDEPENDENT SCRAPING COMPLETED');
    console.log('==================================');
    console.log(`⚡ Final Rate: ${finalRate} parcels/minute`);
    console.log(`✅ Total Completed: ${this.stats.totalCompleted.toLocaleString()}`);
    console.log(`❌ Total Errors: ${this.stats.totalErrors.toLocaleString()}`);
    console.log(`🕐 Total Runtime: ${Math.round(totalTime)} minutes`);
    console.log(`🔒 Independence Level: MAXIMUM (50 Workers)`);
    console.log(`⚖️  Distribution: EVEN (Round-Robin)`);
    console.log(`🌍 Geographic Distribution: ${this.workers.length} Edge Locations`);
    
    const successRate = this.stats.totalAssigned > 0 ? 
      Math.round((this.stats.totalCompleted / this.stats.totalAssigned) * 100) : 0;
    console.log(`📈 Success Rate: ${successRate}%`);
    
    // Show final distribution summary
    console.log('\n📊 Final Worker Distribution Summary:');
    this.workers.forEach(worker => {
      const stats = this.workerStats.get(worker.id);
      const totalAssigned = this.workerParcels.get(worker.id).length;
      const successRate = totalAssigned > 0 ? Math.round((stats.completed / totalAssigned) * 100) : 0;
      console.log(`   🤖 ${worker.id}: ${stats.completed}/${totalAssigned} (${successRate}%) | ${stats.errors} errors`);
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    console.log('\n⏹️  Stopping independent scrapers...');
    this.isRunning = false;
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received interrupt signal...');
  if (global.scraper) {
    global.scraper.stop();
  }
  process.exit(0);
});

// Start scraping
async function main() {
  const scraper = new IndependentSaltLakeCountyScraper();
  global.scraper = scraper;
  
  try {
    await scraper.start();
  } catch (error) {
    console.error('💥 Scraper failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { IndependentSaltLakeCountyScraper };