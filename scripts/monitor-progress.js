#!/usr/bin/env node

/**
 * Monitor Scraping Progress
 * This script monitors the progress by checking the local SQLite database
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Configuration
const WORKER_COUNT = 5;
const REFRESH_INTERVAL = 10000; // 10 seconds
const DB_PATH = path.resolve(__dirname, '../salt_lake_county_lir_parcels.db');
const WORK_DIR = path.join(__dirname, '../work');

class ProgressMonitor {
    constructor() {
        this.startTime = new Date();
        this.lastStats = null;
    }

    async start() {
        console.log('🔍 Starting Salt Lake County Scraping Monitor...\n');
        console.log('Press Ctrl+C to stop monitoring\n');
        
        // Set up graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n\n👋 Monitoring stopped.');
            process.exit(0);
        });

        // Start monitoring loop
        await this.monitorLoop();
    }

    async monitorLoop() {
        while (true) {
            try {
                await this.displayProgress();
                await this.sleep(REFRESH_INTERVAL);
            } catch (error) {
                console.error('❌ Monitoring error:', error.message);
                await this.sleep(REFRESH_INTERVAL);
            }
        }
    }

    async displayProgress() {
        // Clear screen and move cursor to top
        process.stdout.write('\x1b[2J\x1b[0f');
        
        console.log('🏠 Salt Lake County Property Owner Scraper - Live Monitor');
        console.log('=' * 60);
        console.log(`Started: ${this.startTime.toLocaleString()}`);
        console.log(`Current: ${new Date().toLocaleString()}`);
        console.log('');

        // Get overall progress from database
        const overallStats = await this.getOverallProgress();
        this.displayOverallStats(overallStats);

        // Get worker status
        const workerStats = await this.getWorkerStats();
        this.displayWorkerStats(workerStats);

        // Calculate and display rates
        this.displayRates(overallStats);

        console.log('\n' + '=' * 60);
        console.log('Press Ctrl+C to stop monitoring');
    }

    async getOverallProgress() {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(DB_PATH)) {
                resolve({
                    total_parcels: 0,
                    completed: 0,
                    pending: 0,
                    in_progress: 0,
                    failed: 0,
                    completion_percentage: 0
                });
                return;
            }

            const db = new sqlite3.Database(DB_PATH);
            
            // Get total parcels from original table
            db.get('SELECT COUNT(*) as total FROM salt_lake_county_lir_parcels', (err, totalRow) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Get completed from owner_data table
                db.get('SELECT COUNT(*) as completed FROM owner_data', (err, completedRow) => {
                    db.close();
                    
                    if (err) {
                        reject(err);
                        return;
                    }

                    const total = totalRow.total || 0;
                    const completed = completedRow.completed || 0;
                    const pending = total - completed;
                    const completion_percentage = total > 0 ? (completed / total) * 100 : 0;

                    resolve({
                        total_parcels: total,
                        completed: completed,
                        pending: pending,
                        in_progress: 0, // We can't easily track this with current setup
                        failed: 0, // Would need error tracking
                        completion_percentage: completion_percentage
                    });
                });
            });
        });
    }

    async getWorkerStats() {
        const workers = [];
        
        // Check if data collector server is running
        try {
            const response = await fetch('http://localhost:3000/stats');
            if (response.ok) {
                const serverStats = await response.json();
                
                // Get stats from each worker's work file
                for (let i = 1; i <= WORKER_COUNT; i++) {
                    const workerId = `worker-${i}`;
                    const workFile = path.join(WORK_DIR, `${workerId}-parcels.json`);
                    
                    let workData = { parcel_ids: [] };
                    if (fs.existsSync(workFile)) {
                        workData = JSON.parse(fs.readFileSync(workFile, 'utf8'));
                    }

                    workers.push({
                        worker_id: workerId,
                        status: 'active',
                        total_assigned: workData.parcel_ids?.length || 0,
                        parcels_processed: Math.floor(serverStats.totalStored / WORKER_COUNT), // Rough estimate
                        parcels_failed: Math.floor(serverStats.totalErrors / WORKER_COUNT),
                        last_seen: serverStats.lastReceived || 'never'
                    });
                }
            } else {
                throw new Error('Server not responding');
            }
        } catch (error) {
            // Server not running, show offline status
            for (let i = 1; i <= WORKER_COUNT; i++) {
                workers.push({
                    worker_id: `worker-${i}`,
                    status: 'offline',
                    total_assigned: 0,
                    parcels_processed: 0,
                    parcels_failed: 0,
                    last_seen: 'never'
                });
            }
        }
        
        return workers;
    }

    displayOverallStats(stats) {
        console.log('📊 Overall Progress:');
        console.log(`   Total Parcels:    ${stats.total_parcels.toLocaleString()}`);
        console.log(`   Completed:        ${stats.completed.toLocaleString()} (${stats.completion_percentage.toFixed(2)}%)`);
        console.log(`   Pending:          ${stats.pending.toLocaleString()}`);
        console.log(`   In Progress:      ${stats.in_progress.toLocaleString()}`);
        console.log(`   Failed:           ${stats.failed.toLocaleString()}`);
        
        // Progress bar
        const barLength = 40;
        const filledLength = Math.floor((stats.completion_percentage / 100) * barLength);
        const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
        console.log(`   Progress:         [${bar}] ${stats.completion_percentage.toFixed(2)}%`);
        console.log('');
    }

    displayWorkerStats(workers) {
        console.log('🤖 Worker Status:');
        console.log('   ID       | Status  | Assigned | Processed | Failed | Last Seen');
        console.log('   ---------|---------|----------|-----------|--------|------------------');
        
        workers.forEach(worker => {
            const id = worker.worker_id.padEnd(8);
            const status = worker.status.padEnd(7);
            const assigned = worker.total_assigned.toString().padStart(8);
            const processed = worker.parcels_processed.toString().padStart(9);
            const failed = worker.parcels_failed.toString().padStart(6);
            const lastSeen = worker.last_seen === 'never' ? 'never' : 
                             new Date(worker.last_seen).toLocaleTimeString();
            
            console.log(`   ${id} | ${status} | ${assigned} | ${processed} | ${failed} | ${lastSeen}`);
        });
        console.log('');
    }

    displayRates(stats) {
        if (this.lastStats) {
            const timeDiff = (Date.now() - this.lastStats.timestamp) / 1000 / 60; // minutes
            const completedDiff = stats.completed - this.lastStats.completed;
            const rate = timeDiff > 0 ? (completedDiff / timeDiff).toFixed(2) : 0;
            
            console.log('📈 Performance:');
            console.log(`   Current Rate:     ${rate} parcels/minute`);
            
            if (stats.pending > 0 && rate > 0) {
                const eta = (stats.pending / rate) / 60; // hours
                if (eta < 24) {
                    console.log(`   ETA:              ${eta.toFixed(1)} hours`);
                } else {
                    console.log(`   ETA:              ${(eta / 24).toFixed(1)} days`);
                }
            }
        }
        
        this.lastStats = {
            ...stats,
            timestamp: Date.now()
        };
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

async function main() {
    const monitor = new ProgressMonitor();
    await monitor.start();
}

if (require.main === module) {
    main();
}

module.exports = ProgressMonitor;