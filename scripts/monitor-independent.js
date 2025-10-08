#!/usr/bin/env node

/**
 * 🚀 Ultra-Dynamic Independent Scraper Monitor 
 * Real-time monitoring with live charts, animations, and advanced metrics
 * Monitoring 20 Independent Cloudflare Workers with Advanced Anti-Detection
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Configuration
const INDEPENDENT_WORKERS = [
  { id: 'slc-scraper-alpha', url: 'https://slc-scraper-alpha.w2ntsrpc5v.workers.dev', browser: 'Chrome' },
  { id: 'slc-scraper-beta', url: 'https://slc-scraper-beta.w2ntsrpc5v.workers.dev', browser: 'Firefox' },
  { id: 'slc-scraper-gamma', url: 'https://slc-scraper-gamma.w2ntsrpc5v.workers.dev', browser: 'Safari' },
  { id: 'slc-scraper-delta', url: 'https://slc-scraper-delta.w2ntsrpc5v.workers.dev', browser: 'Edge' },
  { id: 'slc-scraper-epsilon', url: 'https://slc-scraper-epsilon.w2ntsrpc5v.workers.dev', browser: 'Opera' },
  { id: 'slc-scraper-zeta', url: 'https://slc-scraper-zeta.w2ntsrpc5v.workers.dev', browser: 'Chrome' },
  { id: 'slc-scraper-eta', url: 'https://slc-scraper-eta.w2ntsrpc5v.workers.dev', browser: 'Firefox' },
  { id: 'slc-scraper-theta', url: 'https://slc-scraper-theta.w2ntsrpc5v.workers.dev', browser: 'Safari' },
  { id: 'slc-scraper-iota', url: 'https://slc-scraper-iota.w2ntsrpc5v.workers.dev', browser: 'Edge' },
  { id: 'slc-scraper-kappa', url: 'https://slc-scraper-kappa.w2ntsrpc5v.workers.dev', browser: 'Opera' },
  { id: 'slc-scraper-lambda', url: 'https://slc-scraper-lambda.w2ntsrpc5v.workers.dev', browser: 'Chrome' },
  { id: 'slc-scraper-mu', url: 'https://slc-scraper-mu.w2ntsrpc5v.workers.dev', browser: 'Firefox' },
  { id: 'slc-scraper-nu', url: 'https://slc-scraper-nu.w2ntsrpc5v.workers.dev', browser: 'Safari' },
  { id: 'slc-scraper-xi', url: 'https://slc-scraper-xi.w2ntsrpc5v.workers.dev', browser: 'Edge' },
  { id: 'slc-scraper-omicron', url: 'https://slc-scraper-omicron.w2ntsrpc5v.workers.dev', browser: 'Opera' },
  { id: 'slc-scraper-pi', url: 'https://slc-scraper-pi.w2ntsrpc5v.workers.dev', browser: 'Chrome' },
  { id: 'slc-scraper-rho', url: 'https://slc-scraper-rho.w2ntsrpc5v.workers.dev', browser: 'Firefox' },
  { id: 'slc-scraper-sigma', url: 'https://slc-scraper-sigma.w2ntsrpc5v.workers.dev', browser: 'Safari' },
  { id: 'slc-scraper-tau', url: 'https://slc-scraper-tau.w2ntsrpc5v.workers.dev', browser: 'Edge' },
  { id: 'slc-scraper-upsilon', url: 'https://slc-scraper-upsilon.w2ntsrpc5v.workers.dev', browser: 'Opera' }
];

const REFRESH_INTERVAL = 3000; // 3 seconds for more dynamic updates
const DB_PATH = path.resolve(__dirname, '../salt_lake_county_lir_parcels.db');

// Colors and emojis for dynamic display
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m'
};

const BROWSER_ICONS = {
  'Chrome': '🌐',
  'Firefox': '🦊', 
  'Safari': '🧭',
  'Edge': '🔷',
  'Opera': '🎭'
};

class UltraDynamicMonitor {
    constructor() {
        this.startTime = new Date();
        this.lastStats = null;
        this.workerHistory = new Map();
        this.frameCount = 0;
        this.updateCount = 0;
        this.lastRate = 0;
        this.activeWorkerCount = 0;
        this.lastCompleted = undefined;
        this.lastUpdate = Date.now();
        this.performanceHistory = [];
        this.maxHistoryLength = 60; // Keep 60 data points (3 minutes at 3s intervals)
        
        // Initialize worker history
        INDEPENDENT_WORKERS.forEach(worker => {
            this.workerHistory.set(worker.id, {
                processed: 0,
                responseTime: 0,
                status: 'unknown',
                trend: []
            });
        });
    }

    async start() {
        // Hide cursor and set up terminal
        process.stdout.write('\x1b[?25l'); // Hide cursor
        
        console.log(`${COLORS.bright}${COLORS.cyan}`);
        console.log('🚀 ULTRA-DYNAMIC INDEPENDENT SCRAPER MONITOR 🚀');
        console.log(`${COLORS.reset}${COLORS.green}⚡ Real-time monitoring of 20 Independent Workers with Advanced Anti-Detection`);
        console.log(`${COLORS.yellow}🔒 Browser Fingerprinting | Geographic Distribution | Maximum Independence`);
        console.log(`${COLORS.reset}\n`);
        
        // Set up graceful shutdown
        process.on('SIGINT', () => {
            process.stdout.write('\x1b[?25h'); // Show cursor
            console.log(`\n\n${COLORS.bright}${COLORS.yellow}👋 Ultra-Dynamic monitoring stopped.${COLORS.reset}`);
            process.exit(0);
        });

        // Start monitoring loop
        await this.monitorLoop();
    }

    async monitorLoop() {
        while (true) {
            try {
                this.frameCount++;
        this.updateCount++;
                await this.displayProgress();
                await this.sleep(REFRESH_INTERVAL);
            } catch (error) {
                console.error(`${COLORS.red}❌ Monitoring error:${COLORS.reset}`, error.message);
                await this.sleep(REFRESH_INTERVAL);
            }
        }
    }

    async displayProgress() {
        // Clear screen and move cursor to top (but don't scroll)
        process.stdout.write('\x1b[2J\x1b[H');
        
        // Animated header
        const animation = ['⚡', '🚀', '💥', '✨'][this.frameCount % 4];
        
        console.log(`${COLORS.bright}${COLORS.bgBlue}${COLORS.white}`);
        console.log(`${animation} SALT LAKE COUNTY ULTRA-DYNAMIC MONITOR ${animation}`);
        console.log(`${COLORS.reset}${COLORS.cyan}🔥 20 Independent Workers | Advanced Anti-Detection | Real-time Analytics`);
        console.log(`${COLORS.reset}${COLORS.dim}Started: ${this.startTime.toLocaleString()} | Current: ${new Date().toLocaleString()}${COLORS.reset}`);
        
        // Reserve exact space for all content to prevent scrolling
        const terminalHeight = process.stdout.rows || 40;
        const contentHeight = 35; // Fixed content height
        
        console.log(''); // 5 lines used so far

        // Get all data
        const [overallStats, workerStats] = await Promise.all([
            this.getOverallProgress(),
            this.getIndependentWorkerStats()
        ]);

        // Update performance tracking
        this.updatePerformanceTracking(overallStats, workerStats);

        // Display components with fixed heights
        this.displayOverallStatsFixed(overallStats);          // 7 lines
        this.displayIndependentWorkerStatsFixed(workerStats); // 12 lines 
        this.displayErrorTrackingFixed(workerStats);          // 8 lines
        this.displayLiveChartFixed();                         // 11 lines
        this.displaySystemMetricsFixed(overallStats, workerStats); // 10 lines

        // Fill remaining space to prevent scrolling
        const usedLines = 5 + 7 + 12 + 8 + 11 + 10; // 53 lines total
        const remainingLines = Math.max(0, terminalHeight - usedLines - 2);
        for (let i = 0; i < remainingLines; i++) {
            console.log('');
        }

        // Fixed footer at bottom
        console.log(`${COLORS.bright}${COLORS.yellow}Press Ctrl+C to stop monitoring${COLORS.reset}`);
    }

    async getOverallProgress() {
        try {
            // Get stats from in-memory server
            const authToken = process.env.COLLECTOR_TOKEN || 'your-secure-token-here';
            const response = await fetch('http://localhost:3000/stats', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                signal: AbortSignal.timeout(2000) // 2 second timeout
            });

            if (response.ok) {
                const stats = await response.json();
                // Calculate remaining parcels (total original parcels - completed)
                const total_original_parcels = 391099; // Total parcels in the database
                const completed = stats.totalStored || 0;
                const remaining = total_original_parcels - completed;
                const completion_percentage = total_original_parcels > 0 ? (completed / total_original_parcels) * 100 : 0;
                
                return {
                    total_parcels: remaining, // Show remaining parcels instead of total
                    completed: completed,
                    pending: remaining,
                    completion_percentage: completion_percentage,
                    source: 'in-memory'
                };
            } else {
                throw new Error(`Server responded with ${response.status}`);
            }
        } catch (error) {
            // Fallback to disk database if server is unavailable
            console.log(`${COLORS.yellow}⚠️  In-memory server unavailable, using disk fallback${COLORS.reset}`);
            return this.getOverallProgressFromDisk();
        }
    }

    async getOverallProgressFromDisk() {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(DB_PATH)) {
                resolve({
                    total_parcels: 0,
                    completed: 0,
                    pending: 0,
                    completion_percentage: 0,
                    source: 'disk'
                });
                return;
            }

            const db = new sqlite3.Database(DB_PATH);
            
            // Get remaining parcels (parcels not yet processed)
            const remainingQuery = `
                SELECT COUNT(*) as remaining 
                FROM salt_lake_county_lir_parcels 
                WHERE parcel_id NOT IN (
                    SELECT DISTINCT parcel_id 
                    FROM owner_data 
                    WHERE parcel_id IS NOT NULL
                )
            `;
            
            db.get(remainingQuery, (err, remainingRow) => {
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

                    const remaining = remainingRow.remaining || 0;
                    const completed = completedRow.completed || 0;
                    const total = remaining + completed; // Total parcels = remaining + completed
                    const completion_percentage = total > 0 ? (completed / total) * 100 : 0;

                    resolve({
                        total_parcels: remaining, // Show remaining parcels instead of total
                        completed: completed,
                        pending: remaining,
                        completion_percentage: completion_percentage,
                        source: 'disk'
                    });
                });
            });
        });
    }

    async getIndependentWorkerStats() {
        const startTime = Date.now();

        // Primary: query each worker's /status endpoint
        const workerPromises = INDEPENDENT_WORKERS.map(async (worker) => {
            const requestStart = Date.now();
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
                
                const response = await fetch(`${worker.url}/status`, {
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'UltraDynamicMonitor/2.1',
                        'Accept': 'application/json'
                    }
                });
                
                clearTimeout(timeoutId);
                const responseTime = Date.now() - requestStart;
                
                if (response.ok) {
                    const status = await response.json();
                    const adaptive = status.adaptive || {};
                    const workerData = await this.getWorkerDataFromDB(worker.id);
                    
                    // Update history
                    const history = this.workerHistory.get(worker.id);
                    history.trend.push(workerData.processed);
                    if (history.trend.length > 10) history.trend.shift();
                    
                    return {
                        worker_id: worker.id,
                        status: 'online',
                        browser: worker.browser,
                        rate_limiting: status.rate_limiting || {
                            enabled: false,
                            consecutive_errors: 0,
                            http_520_count: 0,
                            backoff_until: 0
                        },
                        parcels_processed: workerData.processed,
                        response_time: responseTime,
                        version: status.version || '2.0-independent',
                        fingerprinting: 'advanced',
                        trend: history.trend.length > 1 ? this.calculateTrend(history.trend) : 0,
                        last_seen: new Date().toLocaleTimeString(),
                        adaptive: {
                          refill: adaptive.refillRatePerSec || 0,
                          capacity: adaptive.capacity || 0,
                          tokens: adaptive.tokens || 0,
                          conc: adaptive.concurrency || 0,
                          parcelsPerMin: adaptive.parcelsPerMin || adaptive.parcelsPerMin === 0 ? adaptive.parcelsPerMin : (adaptive.parcelsPerMin || 0),
                          requestsPerMin: adaptive.requestsPerMin || 0,
                          utilization: adaptive.utilization || 0,
                          emaLatency: adaptive.emaLatency || 0,
                          lastAction: adaptive.lastAction || 'n/a'
                        }
                    };
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }
                
            } catch (error) {
                const workerData = await this.getWorkerDataFromDB(worker.id);
                
                return {
                    worker_id: worker.id,
                    status: 'offline',
                    browser: worker.browser,
                    parcels_processed: workerData.processed,
                    response_time: 'N/A',
                    version: 'unknown',
                    fingerprinting: 'unknown',
                    trend: 0,
                    last_seen: 'offline'
                };
            }
        });
        
        const statusResults = await Promise.all(workerPromises);

        // If every worker offline OR zero processed counts, attempt unified collector fallback
        const anyOnline = statusResults.some(w => w.status === 'online');
        const anyProcessed = statusResults.some(w => (w.parcels_processed || 0) > 0);
        if (!anyOnline || !anyProcessed) {
            try {
                const authToken = process.env.COLLECTOR_TOKEN || 'your-secure-token-here';
                const resp = await fetch('http://localhost:3000/workers', { headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${authToken}` }, signal: AbortSignal.timeout(1500) });
                if (resp.ok) {
                    const arr = await resp.json();
                    if (Array.isArray(arr) && arr.length) {
                        // Map unified stats to monitor shape
                        const mapped = arr.map(r => ({
                            worker_id: r.worker_id || r.workerId || 'unknown',
                            status: 'collector',
                            browser: 'n/a',
                            parcels_processed: r.processed || 0,
                            response_time: 'n/a',
                            version: r.version || 'v3',
                            fingerprinting: 'n/a',
                            trend: 0,
                            last_seen: r.lastSeen || 'now'
                        }));
                        return mapped;
                    }
                }
            } catch (_) { /* ignore fallback errors */ }
        }
        return statusResults;
    }

    calculateTrend(trend) {
        if (trend.length < 2) return 0;
        const recent = trend.slice(-3);
        const older = trend.slice(-6, -3);
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;
        return recentAvg - olderAvg;
    }

    async getWorkerDataFromDB(workerId) {
        try {
            // Try to get worker stats from in-memory server
            const authToken = process.env.COLLECTOR_TOKEN || 'your-secure-token-here';
            const response = await fetch(`http://localhost:3000/worker-stats/${workerId}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                signal: AbortSignal.timeout(1000) // 1 second timeout
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    processed: data.processed || 0
                };
            } else {
                throw new Error(`Server responded with ${response.status}`);
            }
        } catch (error) {
            // Fallback to disk database
            return this.getWorkerDataFromDisk(workerId);
        }
    }

    async getWorkerDataFromDisk(workerId) {
        return new Promise((resolve) => {
            if (!fs.existsSync(DB_PATH)) {
                resolve({ processed: 0 });
                return;
            }

            const db = new sqlite3.Database(DB_PATH);
            
            // Count entries processed by this specific worker
            db.get('SELECT COUNT(*) as processed FROM owner_data WHERE worker_id = ?', [workerId], (err, row) => {
                db.close();
                
                if (err) {
                    resolve({ processed: 0 });
                    return;
                }
                
                resolve({
                    processed: row?.processed || 0
                });
            });
        });
    }

    displayOverallStatsFixed(stats) {
        const processed = stats.completed || 0;
        const total = stats.total_parcels || 1;
        const percentage = stats.completion_percentage || 0;
        const progressBar = this.createProgressBar(processed, total, 40);
        
        const dataSource = stats.source === 'in-memory' ? '🚀 IN-MEMORY' : '💾 DISK';
        
        // Fixed height: exactly 7 lines
        console.log(`${COLORS.bright}${COLORS.green}╔════════════════ OVERALL PROGRESS ════════════════╗${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.green}║${COLORS.reset} ${progressBar} ${percentage.toFixed(1)}% ${COLORS.bright}${COLORS.green}║${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.green}║${COLORS.reset} Processed: ${COLORS.cyan}${processed.toLocaleString()}${COLORS.reset} / ${COLORS.yellow}${total.toLocaleString()}${COLORS.reset} parcels           ${COLORS.bright}${COLORS.green}║${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.green}║${COLORS.reset} Rate: ${COLORS.magenta}${this.lastRate || 0}/min${COLORS.reset} | ETA: ${COLORS.cyan}${this.formatETA(stats)}${COLORS.reset}              ${COLORS.bright}${COLORS.green}║${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.green}║${COLORS.reset} Status: ${this.getStatusIndicator()} | Workers: ${COLORS.yellow}${this.activeWorkerCount || 0}/20${COLORS.reset} | DB: ${dataSource}  ${COLORS.bright}${COLORS.green}║${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.green}╚═══════════════════════════════════════════════════╝${COLORS.reset}`);
        console.log(''); // spacer
    }

    displayIndependentWorkerStatsFixed(workers) {
        const online = workers.filter(w => w.status === 'online');
        const offline = workers.filter(w => w.status === 'offline');
        
        // Fixed height: exactly 12 lines 
        console.log(`${COLORS.bright}${COLORS.magenta}╔═══════════ WORKER STATUS (20 Workers) ════════════╗${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.magenta}║${COLORS.reset} Online: ${COLORS.green}${online.length}${COLORS.reset} | Offline: ${COLORS.red}${offline.length}${COLORS.reset} | Total: ${COLORS.cyan}${workers.length}${COLORS.reset}                     ${COLORS.bright}${COLORS.magenta}║${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.magenta}╠═══════════════════════════════════════════════════╣${COLORS.reset}`);
        
        // Show top 8 workers in fixed grid (4 rows x 2 columns) with adaptive snippet
        const workersToShow = workers.slice(0, 8);
        for (let i = 0; i < 8; i += 2) {
            const w1 = workersToShow[i];
            const w2 = workersToShow[i + 1];
            
            const name1 = w1 ? w1.worker_id.replace('slc-scraper-', '') : '';
            const name2 = w2 ? w2.worker_id.replace('slc-scraper-', '') : '';
            
            const status1 = w1 ? `${this.getBrowserIcon(w1.browser)} ${name1}: ${this.getWorkerStatusColor(w1.status)}${w1.status}${COLORS.reset} (${w1.parcels_processed || 0})` : '';
            const status2 = w2 ? `${this.getBrowserIcon(w2.browser)} ${name2}: ${this.getWorkerStatusColor(w2.status)}${w2.status}${COLORS.reset} (${w2.parcels_processed || 0})` : '';

            const adapt1 = w1 && w1.adaptive ? `r${w1.adaptive.refill}/c${w1.adaptive.conc} u${(w1.adaptive.utilization*100).toFixed(0)}%` : '';
            const adapt2 = w2 && w2.adaptive ? `r${w2.adaptive.refill}/c${w2.adaptive.conc} u${(w2.adaptive.utilization*100).toFixed(0)}%` : '';
            
            // Combine with adaptive metrics compressed
            const col1 = adapt1 ? `${status1} ${COLORS.dim}[${adapt1}]${COLORS.reset}` : status1;
            const col2 = adapt2 ? `${status2} ${COLORS.dim}[${adapt2}]${COLORS.reset}` : status2;

            // Pad each column to 40 characters for new data density
            const paddedStatus1 = this.padString(col1, 40);
            const paddedStatus2 = this.padString(col2, 40);
            
            console.log(`${COLORS.bright}${COLORS.magenta}║${COLORS.reset} ${paddedStatus1}${paddedStatus2} ${COLORS.bright}${COLORS.magenta}║${COLORS.reset}`);
        }
        
    const remainingWorkers = Math.max(0, workers.length - 8);
    const tailMsg = `... and ${remainingWorkers} more workers (r=refill/s c=concurrency u=utilization)`;
    console.log(`${COLORS.bright}${COLORS.magenta}║${COLORS.reset} ${this.padString(tailMsg, 80)} ${COLORS.bright}${COLORS.magenta}║${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.magenta}╚═══════════════════════════════════════════════════╝${COLORS.reset}`);
        console.log(''); // spacer
    }

    padString(str, length) {
        const cleanLength = this.stripAnsi(str).length;
        const padding = Math.max(0, length - cleanLength);
        return str + ' '.repeat(padding);
    }

    displayErrorTrackingFixed(workers) {
        const onlineWorkers = workers.filter(w => w.status === 'online');
        const workersWithErrors = onlineWorkers.filter(w => w.rate_limiting && w.rate_limiting.consecutive_errors > 0);
        const workersWithHttp520 = onlineWorkers.filter(w => w.rate_limiting && w.rate_limiting.http_520_count > 0);
        const workersInBackoff = onlineWorkers.filter(w => w.rate_limiting && w.rate_limiting.backoff_until > Date.now());
        
        // Calculate total error counts
        const totalHttp520 = onlineWorkers.reduce((sum, w) => sum + (w.rate_limiting?.http_520_count || 0), 0);
        const totalConsecutiveErrors = workersWithErrors.reduce((sum, w) => sum + (w.rate_limiting?.consecutive_errors || 0), 0);
        
        console.log(`${COLORS.bright}${COLORS.red}╔══════════ ERROR TRACKING & RATE LIMITING ═════════╗${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.red}║${COLORS.reset} HTTP 520 Errors: ${COLORS.red}${totalHttp520}${COLORS.reset} | Consecutive Errors: ${COLORS.yellow}${totalConsecutiveErrors}${COLORS.reset}        ${COLORS.bright}${COLORS.red}║${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.red}║${COLORS.reset} Workers in Backoff: ${COLORS.magenta}${workersInBackoff.length}${COLORS.reset} | With Errors: ${COLORS.yellow}${workersWithErrors.length}${COLORS.reset}          ${COLORS.bright}${COLORS.red}║${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.red}╠═══════════════════════════════════════════════════╣${COLORS.reset}`);
        
        // Show worst 4 workers (highest error counts)
        const problemWorkers = onlineWorkers
            .filter(w => w.rate_limiting && (w.rate_limiting.consecutive_errors > 0 || w.rate_limiting.http_520_count > 0))
            .sort((a, b) => {
                const aScore = (a.rate_limiting?.http_520_count || 0) * 10 + (a.rate_limiting?.consecutive_errors || 0);
                const bScore = (b.rate_limiting?.http_520_count || 0) * 10 + (b.rate_limiting?.consecutive_errors || 0);
                return bScore - aScore;
            })
            .slice(0, 4);
        
        if (problemWorkers.length > 0) {
            problemWorkers.forEach(worker => {
                const name = worker.worker_id.replace('slc-scraper-', '');
                const errors520 = worker.rate_limiting?.http_520_count || 0;
                const consecutive = worker.rate_limiting?.consecutive_errors || 0;
                const inBackoff = worker.rate_limiting?.backoff_until > Date.now() ? '🛑' : '✅';
                
                const statusLine = `${inBackoff} ${name}: 520s=${COLORS.red}${errors520}${COLORS.reset} | Cons=${COLORS.yellow}${consecutive}${COLORS.reset}`;
                const paddedLine = this.padString(statusLine, 47);
                console.log(`${COLORS.bright}${COLORS.red}║${COLORS.reset} ${paddedLine} ${COLORS.bright}${COLORS.red}║${COLORS.reset}`);
            });
        } else {
            console.log(`${COLORS.bright}${COLORS.red}║${COLORS.reset} ${COLORS.green}✅ All workers healthy - no HTTP 520 errors!${COLORS.reset}     ${COLORS.bright}${COLORS.red}║${COLORS.reset}`);
        }
        
        // Fill remaining lines to total 8
        const remainingLines = 4 - (problemWorkers.length > 0 ? problemWorkers.length : 1);
        for (let i = 0; i < remainingLines; i++) {
            console.log(`${COLORS.bright}${COLORS.red}║${COLORS.reset}${' '.repeat(49)}${COLORS.bright}${COLORS.red}║${COLORS.reset}`);
        }
        
        console.log(`${COLORS.bright}${COLORS.red}╚═══════════════════════════════════════════════════╝${COLORS.reset}`);
        console.log(''); // spacer
    }

    displayLiveChartFixed() {
        const chartData = this.performanceHistory.slice(-20);
        
        // Fixed height: exactly 11 lines
        console.log(`${COLORS.bright}${COLORS.cyan}╔════════════ LIVE PERFORMANCE CHART ══════════════╗${COLORS.reset}`);
        
        if (chartData.length > 0) {
            const maxRate = Math.max(...chartData.map(d => d.rate), 1);
            const chartHeight = 6;
            
            for (let row = chartHeight - 1; row >= 0; row--) {
                let line = `${COLORS.bright}${COLORS.cyan}║${COLORS.reset} `;
                const threshold = (maxRate / chartHeight) * (row + 1);
                
                for (let i = 0; i < Math.min(20, chartData.length); i++) {
                    const rate = chartData[i]?.rate || 0;
                    if (rate >= threshold) {
                        line += rate > (maxRate * 0.8) ? `${COLORS.green}█${COLORS.reset}` : 
                               rate > (maxRate * 0.5) ? `${COLORS.yellow}█${COLORS.reset}` : 
                               `${COLORS.red}█${COLORS.reset}`;
                    } else {
                        line += ' ';
                    }
                }
                
                line += ' '.repeat(Math.max(0, 47 - this.stripAnsi(line).length + 5)) + ` ${COLORS.bright}${COLORS.cyan}║${COLORS.reset}`;
                console.log(line);
            }
            
            console.log(`${COLORS.bright}${COLORS.cyan}║${COLORS.reset} Last 20 intervals | Max: ${COLORS.yellow}${maxRate.toFixed(1)}/min${COLORS.reset}${' '.repeat(15)} ${COLORS.bright}${COLORS.cyan}║${COLORS.reset}`);
        } else {
            for (let i = 0; i < 7; i++) {
                console.log(`${COLORS.bright}${COLORS.cyan}║${COLORS.reset} Collecting data...${' '.repeat(32)} ${COLORS.bright}${COLORS.cyan}║${COLORS.reset}`);
            }
        }
        
        console.log(`${COLORS.bright}${COLORS.cyan}╚═══════════════════════════════════════════════════╝${COLORS.reset}`);
        console.log(''); // spacer
    }

    displaySystemMetricsFixed(overallStats, workerStats) {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        const uptimeStr = this.formatUptime(uptime);
        const memUsage = process.memoryUsage();
        const memMB = (memUsage.rss / 1024 / 1024).toFixed(1);
        
        const browserCounts = {};
        workerStats.forEach(w => {
            const browser = w.browser || 'unknown';
            browserCounts[browser] = (browserCounts[browser] || 0) + 1;
        });
        
        // Fixed height: exactly 10 lines
        console.log(`${COLORS.bright}${COLORS.yellow}╔═════════════ SYSTEM METRICS ══════════════════════╗${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.yellow}║${COLORS.reset} Uptime: ${COLORS.cyan}${uptimeStr}${COLORS.reset} | Memory: ${COLORS.magenta}${memMB}MB${COLORS.reset}${' '.repeat(Math.max(0, 25 - uptimeStr.length - memMB.length))} ${COLORS.bright}${COLORS.yellow}║${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.yellow}║${COLORS.reset} Frame: ${COLORS.green}${this.frameCount}${COLORS.reset} | Updates: ${COLORS.cyan}${this.updateCount}${COLORS.reset}${' '.repeat(Math.max(0, 30 - this.frameCount.toString().length - this.updateCount.toString().length))} ${COLORS.bright}${COLORS.yellow}║${COLORS.reset}`);
        console.log(`${COLORS.bright}${COLORS.yellow}╠═══════════════════════════════════════════════════╣${COLORS.reset}`);
        
        // Browser distribution
        const browsers = Object.keys(browserCounts).slice(0, 5);
        for (let i = 0; i < 5; i++) {
            const browser = browsers[i];
            if (browser) {
                const count = browserCounts[browser];
                const icon = this.getBrowserIcon(browser);
                const line = `${icon} ${browser}: ${COLORS.cyan}${count}${COLORS.reset} workers`;
                console.log(`${COLORS.bright}${COLORS.yellow}║${COLORS.reset} ${line}${' '.repeat(Math.max(0, 47 - this.stripAnsi(line).length))} ${COLORS.bright}${COLORS.yellow}║${COLORS.reset}`);
            } else {
                console.log(`${COLORS.bright}${COLORS.yellow}║${COLORS.reset}${' '.repeat(49)} ${COLORS.bright}${COLORS.yellow}║${COLORS.reset}`);
            }
        }
        
        console.log(`${COLORS.bright}${COLORS.yellow}╚═══════════════════════════════════════════════════╝${COLORS.reset}`);
    }

    getWorkerStatusColor(status) {
        switch (status) {
            case 'online': return COLORS.green;
            case 'offline': return COLORS.red;
            default: return COLORS.yellow;
        }
    }

    getBrowserIcon(browser) {
        return BROWSER_ICONS[browser] || '🌐';
    }

    stripAnsi(str) {
        return str.replace(/\x1b\[[0-9;]*m/g, '');
    }

    formatUptime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours}h ${minutes}m ${secs}s`;
    }

    formatETA(stats) {
        if (!stats.completion_percentage || stats.completion_percentage === 0) {
            return 'calculating...';
        }
        
        const rate = this.lastRate || 0;
        if (rate === 0) return 'calculating...';
        
        const remaining = stats.pending || 0;
        const minutesLeft = Math.ceil(remaining / rate);
        
        if (minutesLeft < 60) {
            return `${minutesLeft}m`;
        } else {
            const hours = Math.floor(minutesLeft / 60);
            const mins = minutesLeft % 60;
            return `${hours}h ${mins}m`;
        }
    }

    displayOverallStats(stats) {
        console.log(`${COLORS.bright}${COLORS.green}� OVERALL PROGRESS${COLORS.reset}`);
        console.log(`${COLORS.white}┌─────────────────────────────────────────────────────────────────────────┐${COLORS.reset}`);
        console.log(`${COLORS.white}│${COLORS.reset} Parcels Left:     ${COLORS.bright}${stats.total_parcels.toLocaleString().padStart(12)}${COLORS.reset}${COLORS.white} │${COLORS.reset}`);
        console.log(`${COLORS.white}│${COLORS.reset} Completed:        ${COLORS.green}${stats.completed.toLocaleString().padStart(12)}${COLORS.reset} (${COLORS.cyan}${stats.completion_percentage.toFixed(2)}%${COLORS.reset})${COLORS.white} │${COLORS.reset}`);
        console.log(`${COLORS.white}│${COLORS.reset} Remaining:        ${COLORS.yellow}${stats.pending.toLocaleString().padStart(12)}${COLORS.reset}${COLORS.white} │${COLORS.reset}`);
        
        // Dynamic progress bar with colors
        const barLength = 50;
        const filledLength = Math.floor((stats.completion_percentage / 100) * barLength);
        const percentage = stats.completion_percentage;
        
        let barColor = COLORS.red;
        if (percentage > 75) barColor = COLORS.green;
        else if (percentage > 50) barColor = COLORS.yellow;
        else if (percentage > 25) barColor = COLORS.cyan;
        
        const filledBar = `${barColor}${'█'.repeat(filledLength)}${COLORS.reset}`;
        const emptyBar = `${COLORS.dim}${'░'.repeat(barLength - filledLength)}${COLORS.reset}`;
        
        console.log(`${COLORS.white}│${COLORS.reset} Progress:         [${filledBar}${emptyBar}] ${COLORS.bright}${stats.completion_percentage.toFixed(2)}%${COLORS.reset}${COLORS.white} │${COLORS.reset}`);
        console.log(`${COLORS.white}└─────────────────────────────────────────────────────────────────────────┘${COLORS.reset}\n`);
    }

    displayIndependentWorkerStats(workers) {
        console.log(`${COLORS.bright}${COLORS.magenta}🤖 INDEPENDENT WORKER STATUS (20 Workers)${COLORS.reset}`);
        
        // Group workers by status
        const online = workers.filter(w => w.status === 'online');
        const offline = workers.filter(w => w.status === 'offline');
        
        console.log(`${COLORS.green}🟢 Online: ${online.length}${COLORS.reset} | ${COLORS.red}🔴 Offline: ${offline.length}${COLORS.reset} | ${COLORS.cyan}📊 Total: ${workers.length}${COLORS.reset}\n`);
        
        // Header
        console.log(`${COLORS.white}┌─────────────────┬────────┬─────────┬───────────┬─────────┬──────────────┐${COLORS.reset}`);
        console.log(`${COLORS.white}│${COLORS.bright} Worker ID       ${COLORS.reset}${COLORS.white}│${COLORS.bright} Status ${COLORS.reset}${COLORS.white}│${COLORS.bright} Browser ${COLORS.reset}${COLORS.white}│${COLORS.bright} Processed ${COLORS.reset}${COLORS.white}│${COLORS.bright} Trend   ${COLORS.reset}${COLORS.white}│${COLORS.bright} Response     ${COLORS.reset}${COLORS.white}│${COLORS.reset}`);
        console.log(`${COLORS.white}├─────────────────┼────────┼─────────┼───────────┼─────────┼──────────────┤${COLORS.reset}`);
        
        workers.forEach(worker => {
            const id = worker.worker_id.replace('slc-scraper-', '').padEnd(15);
            const statusIcon = worker.status === 'online' ? '🟢' : '🔴';
            const status = (statusIcon + ' ' + worker.status.substring(0,4)).padEnd(7);
            const browserIcon = BROWSER_ICONS[worker.browser] || '❓';
            const browser = (browserIcon + ' ' + worker.browser.substring(0,4)).padEnd(8);
            const processed = worker.parcels_processed.toString().padStart(9);
            
            // Trend indicator
            let trendIcon = '→';
            let trendColor = COLORS.white;
            if (worker.trend > 0) {
                trendIcon = '↗';
                trendColor = COLORS.green;
            } else if (worker.trend < 0) {
                trendIcon = '↘';
                trendColor = COLORS.red;
            }
            const trend = `${trendColor}${trendIcon} ${Math.abs(worker.trend).toFixed(0)}${COLORS.reset}`.padEnd(15);
            
            const responseTime = worker.response_time === 'N/A' ? 
                `${COLORS.red}N/A${COLORS.reset}`.padEnd(20) : 
                `${COLORS.green}${worker.response_time}ms${COLORS.reset}`.padEnd(20);
            
            console.log(`${COLORS.white}│${COLORS.reset} ${id}${COLORS.white}│${COLORS.reset} ${status}${COLORS.white}│${COLORS.reset} ${browser}${COLORS.white}│${COLORS.reset} ${processed} ${COLORS.white}│${COLORS.reset} ${trend}${COLORS.white}│${COLORS.reset} ${responseTime}${COLORS.white}│${COLORS.reset}`);
        });
        
        console.log(`${COLORS.white}└─────────────────┴────────┴─────────┴───────────┴─────────┴──────────────┘${COLORS.reset}\n`);
    }

    displayLiveChart() {
        console.log(`${COLORS.bright}${COLORS.cyan}📈 LIVE PERFORMANCE CHART${COLORS.reset}`);
        
        if (this.performanceHistory.length < 2) {
            console.log(`${COLORS.dim}Collecting data for chart... (${this.performanceHistory.length}/3)${COLORS.reset}\n`);
            return;
        }
        
        const chartWidth = 60;
        const chartHeight = 8;
        const maxValue = Math.max(...this.performanceHistory.map(p => p.rate));
        
        console.log(`${COLORS.white}Rate (parcels/min) - Last ${this.performanceHistory.length} measurements${COLORS.reset}`);
        
        for (let row = chartHeight; row >= 0; row--) {
            const threshold = (maxValue / chartHeight) * row;
            let line = `${COLORS.dim}${threshold.toFixed(0).padStart(4)}${COLORS.reset} │`;
            
            for (let col = 0; col < Math.min(chartWidth, this.performanceHistory.length); col++) {
                const dataIndex = Math.max(0, this.performanceHistory.length - chartWidth + col);
                const value = this.performanceHistory[dataIndex]?.rate || 0;
                
                if (value >= threshold) {
                    line += `${COLORS.green}▓${COLORS.reset}`;
                } else {
                    line += `${COLORS.dim}░${COLORS.reset}`;
                }
            }
            
            console.log(line);
        }
        
        console.log(`${COLORS.dim}     └${'─'.repeat(Math.min(chartWidth, this.performanceHistory.length))}${COLORS.reset}`);
        console.log(`${COLORS.dim}      ${new Date().toLocaleTimeString()}${COLORS.reset}\n`);
    }

    displaySystemMetrics(overallStats, workerStats) {
        const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
        const uptimeFormatted = this.formatUptime(uptime);
        
        // Calculate current rate
        let currentRate = 0;
        if (this.lastStats && this.lastStats.timestamp) {
            const timeDiff = (Date.now() - this.lastStats.timestamp) / 1000 / 60; // minutes
            const completedDiff = overallStats.completed - this.lastStats.completed;
            currentRate = timeDiff > 0 ? (completedDiff / timeDiff) : 0;
        }
        
        // Add to performance history
        this.performanceHistory.push({
            timestamp: Date.now(),
            rate: currentRate,
            completed: overallStats.completed
        });
        
        if (this.performanceHistory.length > this.maxHistoryLength) {
            this.performanceHistory.shift();
        }
        
        // Browser distribution
        const browserCounts = {};
        workerStats.forEach(worker => {
            browserCounts[worker.browser] = (browserCounts[worker.browser] || 0) + 1;
        });
        
        console.log(`${COLORS.bright}${COLORS.blue}⚡ SYSTEM METRICS${COLORS.reset}`);
        console.log(`${COLORS.white}┌─────────────────────────────────────────────────────────────────────────┐${COLORS.reset}`);
        console.log(`${COLORS.white}│${COLORS.reset} Uptime:           ${COLORS.cyan}${uptimeFormatted.padEnd(20)}${COLORS.reset}${COLORS.white} │${COLORS.reset}`);
        console.log(`${COLORS.white}│${COLORS.reset} Current Rate:     ${COLORS.green}${currentRate.toFixed(2)} parcels/min${COLORS.reset}${COLORS.white} │${COLORS.reset}`);
        console.log(`${COLORS.white}│${COLORS.reset} Target Rate:      ${COLORS.yellow}600+ parcels/min (20 workers)${COLORS.reset}${COLORS.white} │${COLORS.reset}`);
        console.log(`${COLORS.white}│${COLORS.reset} Anti-Detection:   ${COLORS.green}🔒 Advanced Browser Fingerprinting${COLORS.reset}${COLORS.white} │${COLORS.reset}`);
        console.log(`${COLORS.white}│${COLORS.reset} Independence:     ${COLORS.green}✅ Maximum (20 Unique Identities)${COLORS.reset}${COLORS.white} │${COLORS.reset}`);
        
        // Browser distribution display
        let browserLine = ' Browser Mix:      ';
        Object.entries(browserCounts).forEach(([browser, count]) => {
            const icon = BROWSER_ICONS[browser] || '❓';
            browserLine += `${icon}${count} `;
        });
        console.log(`${COLORS.white}│${COLORS.reset}${browserLine.padEnd(76)}${COLORS.white} │${COLORS.reset}`);
        
        // ETA calculation
        if (overallStats.pending > 0 && currentRate > 0) {
            const eta = (overallStats.pending / currentRate) / 60; // hours
            const etaFormatted = eta < 24 ? `${eta.toFixed(1)} hours` : `${(eta / 24).toFixed(1)} days`;
            console.log(`${COLORS.white}│${COLORS.reset} ETA:              ${COLORS.magenta}${etaFormatted.padEnd(20)}${COLORS.reset}${COLORS.white} │${COLORS.reset}`);
        }
        
        console.log(`${COLORS.white}└─────────────────────────────────────────────────────────────────────────┘${COLORS.reset}`);
        
        // Update last stats
        this.lastStats = {
            ...overallStats,
            timestamp: Date.now()
        };
    }

    formatUptime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    createProgressBar(current, total, length = 40) {
        const percentage = total > 0 ? (current / total) : 0;
        const filledLength = Math.floor(percentage * length);
        
        let barColor = COLORS.red;
        if (percentage > 0.75) barColor = COLORS.green;
        else if (percentage > 0.5) barColor = COLORS.yellow;
        else if (percentage > 0.25) barColor = COLORS.cyan;
        
        const filled = `${barColor}${'█'.repeat(filledLength)}${COLORS.reset}`;
        const empty = `${COLORS.dim}${'░'.repeat(length - filledLength)}${COLORS.reset}`;
        
        return `[${filled}${empty}]`;
    }

    updatePerformanceTracking(overallStats, workerStats) {
        // Track performance data
        const completed = overallStats.completed || 0;
        const currentTime = Date.now();
        
        if (this.lastCompleted !== undefined) {
            const timeDiff = (currentTime - this.lastUpdate) / 1000 / 60; // minutes
            const completedDiff = completed - this.lastCompleted;
            const rate = timeDiff > 0 ? Math.round(completedDiff / timeDiff) : 0;
            
            this.lastRate = rate;
            this.performanceHistory.push({
                timestamp: currentTime,
                rate: rate,
                completed: completed
            });
            
            // Keep only last 50 data points
            if (this.performanceHistory.length > 50) {
                this.performanceHistory.shift();
            }
        }
        
        this.lastCompleted = completed;
        this.lastUpdate = currentTime;
        this.activeWorkerCount = workerStats.filter(w => w.status === 'online').length;
    }

    getStatusIndicator() {
        const indicators = ['🟢', '🔴', '🟡', '🟠'];
        const colors = [COLORS.green, COLORS.red, COLORS.yellow, COLORS.magenta];
        const index = this.frameCount % indicators.length;
        return `${colors[index]}${indicators[index]}${COLORS.reset}`;
    }
}

async function main() {
    const monitor = new UltraDynamicMonitor();
    await monitor.start();
}

if (require.main === module) {
    main();
}

module.exports = UltraDynamicMonitor;