#!/usr/bin/env node

/**
 * Local Data Collector Server
 * Receives scraped data from Cloudflare Workers and stores it in local SQLite database
 */

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Configuration
const PORT = process.env.PORT || 3000;
const DB_PATH = path.resolve(__dirname, '../salt_lake_county_lir_parcels.db');
const AUTH_TOKEN = process.env.COLLECTOR_TOKEN || 'your-secure-token-here';
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

class DataCollector {
    constructor() {
        // SQL logging controls
    // Enable SQL logging and file output by default; set to '0' to disable
    this.LOG_SQL = (process.env.LOG_SQL === '0') ? false : true;
    this.LOG_TO_FILE = (process.env.LOG_TO_FILE === '0') ? false : true;
    // Default to the main server.log in the repo root so logs are centralized
    this.SQL_LOG_PATH = path.resolve(__dirname, '..', process.env.SQL_LOG_PATH || 'server.log');

        // helper to log SQL statements and params
        this.logSql = (sql, params) => {
            if (!this.LOG_SQL) return;
            try {
                const ts = new Date().toISOString();
                const entry = [`[${ts}] SQL: ${sql.trim()}`, `PARAMS: ${JSON.stringify(params || [])}`].join(' | ');
                console.log(entry);
                if (this.LOG_TO_FILE) {
                    fs.appendFile(this.SQL_LOG_PATH, entry + '\n', (err) => {
                        if (err) console.error('❌ Failed to write SQL log file:', err.message);
                    });
                }
            } catch (e) {
                console.log('❌ logSql error', e && e.message);
            }
        };
        // Initialize Express app
        this.app = express();
        
        // Initialize stats tracking
        this.stats = {
            totalReceived: 0,
            totalStored: 0,
            totalErrors: 0,
            lastReceived: null,
            startTime: new Date(),
            memoryFlushes: 0
        };
        
        // Track parcels currently being processed to prevent duplicate work
        this.allocatedParcels = new Set();
        this.workerAllocations = new Map(); // workerId -> Set of parcel_ids
    // Runtime adaptive metrics snapshots reported by workers
    this.runtimeMetrics = new Map(); // workerId -> { snapshot }
        // Global parcel pool for fair distribution to idle workers
        this.globalParcelPool = []; // array of parcel_id strings (unprocessed)
        this.allocationStats = {
            poolBuiltAt: null,
            lastRefresh: null,
            totalAllocations: 0,            // total parcel ids allocated (reallocate + global)
            totalGlobalServed: 0,           // parcel ids served from global pool
            reallocateServed: 0,            // parcel ids served via /reallocate
            globalAllocationRequests: 0,
            reallocateRequests: 0,
            poolRefills: 0,
            poolHitsEmpty: 0
        };
        // Pool sizing targets
        this.GLOBAL_POOL_TARGET = 800; // aim to keep this many unprocessed IDs buffered
        this.GLOBAL_POOL_MIN = 120;    // if below this, trigger aggressive refill
        this.GLOBAL_POOL_REFRESH_INTERVAL_MS = 5000; // periodic top-off cadence
        
    this.setupMiddleware();
    this.setupRoutes();
    this.connectDatabase();
    this.startPeriodicFlush(); // now performs WAL checkpoints on disk DB
    this.startAllocationCleanup();
    this.startGlobalPoolRefresher();
    this.startPeriodicBackup();

        // In-memory dynamic config (persisting minimal key/value in memory + optional disk injection later)
        this.dynamicConfig = {
            INTERNAL_PARALLEL: parseInt(process.env.INTERNAL_PARALLEL || '4'),
            PIPELINE_TRIGGER_FRACTION: 0.5
        };
    }

    // Clean up stale allocations every 2 minutes (logging only for now)
    startAllocationCleanup() {
        this.allocationCleanupInterval = setInterval(() => {
            for (const [workerId, allocatedParcels] of this.workerAllocations.entries()) {
                if (allocatedParcels.size > 0) {
                    console.log(`🔍 Worker ${workerId} has ${allocatedParcels.size} allocated parcels`);
                }
            }
            console.log(`📊 Total allocated parcels: ${this.allocatedParcels.size}, Workers with allocations: ${this.workerAllocations.size}, GlobalPoolSize=${this.globalParcelPool.length}`);
        }, 2 * 60 * 1000);
    }

    // Periodically ensure global pool is topped up
    startGlobalPoolRefresher() {
        setInterval(() => {
            this.maybeRefreshGlobalPool();
        }, this.GLOBAL_POOL_REFRESH_INTERVAL_MS);
    }

    maybeRefreshGlobalPool(force = false) {
        if (!force && this.globalParcelPool.length >= this.GLOBAL_POOL_TARGET) return;
        if (!force && this.globalParcelPool.length > this.GLOBAL_POOL_MIN && (Date.now() - (this.allocationStats.lastRefresh || 0) < 3000)) return;
        this.refreshGlobalParcelPool();
    }

    refreshGlobalParcelPool() {
        // Build or top-off pool with unprocessed parcel IDs
        // Unprocessed means: not in owner_data OR in owner_data with blank owner_name (failed scrape)
        const needed = this.GLOBAL_POOL_TARGET - this.globalParcelPool.length;
        if (needed <= 0) return;
        const limit = Math.min(needed * 5, 5000); // over-fetch more aggressively to filter
        
        console.log(`🔄 Refreshing global pool (need ${needed}, fetching ${limit})...`);
        
        // Use DISK database for accurate picture of processed parcels
        // Include parcels that: 1) aren't in owner_data, OR 2) have blank/null owner_name
        const sql = `SELECT slc.PARCEL_ID as parcel_id 
            FROM salt_lake_county_lir_parcels slc
            LEFT JOIN owner_data od ON slc.PARCEL_ID = od.parcel_id
            WHERE od.parcel_id IS NULL 
               OR od.owner_name IS NULL 
               OR od.owner_name = ''
            ORDER BY slc.PARCEL_ID
            LIMIT ?`;
            
        this.diskDb.all(sql, [limit], (err, rows) => {
            if (err) {
                console.error('❌ Error building global parcel pool:', err.message);
                return;
            }
            
            console.log(`📥 Found ${rows.length} unprocessed parcels from disk database`);
            
            let added = 0;
            const existing = new Set(this.globalParcelPool);
            for (const r of rows) {
                const pid = r.parcel_id;
                if (!pid) continue;
                if (existing.has(pid)) continue; // already in pool
                if (this.allocatedParcels.has(pid)) continue; // currently allocated externally
                existing.add(pid);
                this.globalParcelPool.push(pid);
                added++;
                if (this.globalParcelPool.length >= this.GLOBAL_POOL_TARGET) break;
            }
            if (added > 0) {
                this.allocationStats.poolRefills++;
                this.allocationStats.lastRefresh = Date.now();
                if (!this.allocationStats.poolBuiltAt) this.allocationStats.poolBuiltAt = new Date().toISOString();
                console.log(`🌊 Global pool refill: +${added} parcels (pool size now ${this.globalParcelPool.length})`);
            } else {
                console.log(`⚠️ No new parcels added to pool (found ${rows.length} candidates, all filtered out)`);
            }
        });
    }

    setupMiddleware() {
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));
        
        // CORS for local development
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            if (req.method === 'OPTIONS') {
                res.sendStatus(200);
            } else {
                next();
            }
        });

        // Request logging
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
            next();
        });
    }

    // New unified collectData (supports single record & embedded batch under /collect route)
    collectData(req, res) {
        console.log(`📥 collectData called with body:`, JSON.stringify(req.body, null, 2));

        const { records } = req.body;
        if (Array.isArray(records)) {
            if (records.length === 0) {
                return res.json({ success: true, stored: 0, message: 'empty records array' });
            }
            console.log(`🧾 Detected batch-style payload at /collect with ${records.length} records`);
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');
                const insertSQL = `
                    INSERT OR REPLACE INTO owner_data (
                        parcel_id, owner_name, property_address, total_acreage,
                        property_type, market_value, market_value_year,
                        worker_id, scraped_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                const stmt = this.db.prepare(insertSQL);
                let stored = 0; let errs = 0;
                records.forEach(r => {
                    if (!r.parcel_id) { errs++; return; }
                    stmt.run([
                        r.parcel_id,
                        r.owner,
                        r.address,
                        r.total_acreage,
                        r.property_type,
                        r.market_value,
                        r.market_value_year,
                        r.worker_id,
                        r.scraped_at || new Date().toISOString()
                    ], (err) => {
                        if (err) { errs++; console.error(`❌ Error storing parcel ${r.parcel_id}:`, err.message); }
                        else {
                            stored++;
                            // Deallocate parcel if it was tracked
                            if (this.allocatedParcels.delete(r.parcel_id)) {
                                for (const [wid, set] of this.workerAllocations.entries()) {
                                    if (set.delete(r.parcel_id) && set.size === 0) {
                                        this.workerAllocations.delete(wid);
                                        break;
                                    }
                                }
                            }
                        }
                    });
                });
                stmt.finalize(() => {
                    this.db.run('COMMIT', (err) => {
                        if (err) {
                            console.error('❌ Commit failed for batch-style /collect:', err.message);
                            this.db.run('ROLLBACK');
                            return res.status(500).json({ error: 'transaction failed' });
                        }
                        this.stats.totalReceived += records.length;
                        this.stats.totalStored += stored;
                        this.stats.totalErrors += errs;
                        this.stats.lastReceived = new Date();
                        console.log(`✅ Stored batch-style /collect: ${stored}/${records.length} (errors=${errs})`);
                        return res.json({ success: true, total: records.length, stored, errors: errs });
                    });
                });
            });
            return;
        }

        // Single record legacy path
        const { parcel_id, owner, worker_id, scraped_at } = req.body;
        console.log(`🔍 Parsed parcel_id: ${parcel_id}`);
        if (!parcel_id) {
            console.log(`❌ Missing parcel_id (single-record payload), fetching next unprocessed parcel...`);
            const selectQuery = `
                SELECT PARCEL_ID as parcel_id 
                FROM salt_lake_county_lir_parcels 
                WHERE PARCEL_ID NOT IN (
                    SELECT DISTINCT parcel_id 
                    FROM owner_data 
                    WHERE parcel_id IS NOT NULL
                )
                ORDER BY PARCEL_ID 
                LIMIT 1
            `;
            this.db.get(selectQuery, [], (err, row) => {
                if (err) {
                    console.error('❌ Database error fetching parcel:', err.message);
                    return res.status(500).json({ error: 'Database error' });
                }
                if (!row || !row.parcel_id) {
                    console.log('✅ No more parcels to process');
                    return res.json({ message: 'No more parcels to process' });
                }
                this.insertOwnerData(row.parcel_id, owner, worker_id, scraped_at, res);
            });
        } else {
            this.insertOwnerData(parcel_id, owner, worker_id, scraped_at, res);
        }
    }

    setupRoutes() {
        // Health check
        this.app.get('/', (req, res) => {
            res.json({
                service: 'Salt Lake County Data Collector',
                status: 'running',
                stats: this.stats
            });
        });

        // Collect scraped data
        this.app.post('/collect', this.authenticate.bind(this), this.collectData.bind(this));

        // Batch collect
        this.app.post('/collect-batch', this.authenticate.bind(this), this.collectBatch.bind(this));

        // Get statistics
        this.app.get('/stats', (req, res) => {
            const counts = {};
            // Total parcels from parcel table
            this.db.get('SELECT COUNT(*) as total FROM salt_lake_county_lir_parcels', [], (err, totalRow) => {
                counts.totalParcels = err ? 0 : totalRow.total;
                // Parcels with owner names (successful scrapes)
                this.db.get('SELECT COUNT(*) as with_owners FROM owner_data WHERE owner_name IS NOT NULL AND owner_name != ""', [], (err2, ownersRow) => {
                    const withOwners = err2 ? 0 : ownersRow.with_owners;
                    counts.completedParcels = withOwners;
                    counts.remainingParcels = Math.max(0, counts.totalParcels - withOwners);

                    // Provide persisted counts for dashboard resilience.
                    // totalStored is derived from DB (owner_data rows). totalReceived falls back to stored count when runtime counter is zero.
                    counts.totalStored = withOwners;
                    counts.totalReceived = (this.stats.totalReceived && this.stats.totalReceived > 0) ? this.stats.totalReceived : withOwners;

                    res.json({
                        ...this.stats,
                        ...counts,
                        breakdown: {
                            diskWithOwners: withOwners
                        },
                        performance: {
                            mode: 'disk-only',
                            disk_with_owners: withOwners,
                            total_successful: withOwners,
                            wal_checkpoint_interval: '60 seconds'
                        }
                    });
                });
            });
        });

        // Get recent data from memory database
        this.app.get('/recent/:limit?', (req, res) => {
            const limit = parseInt(req.params.limit) || 10;
            this.db.all('SELECT * FROM owner_data ORDER BY scraped_at DESC LIMIT ?', [limit], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({
                    source: 'disk',
                    count: rows.length,
                    data: rows
                });
            });
        });

        // Force flush memory to disk
        this.app.post('/flush', (req, res) => {
                console.log('🔥 Manual WAL checkpoint requested via API');
                // Run WAL checkpoint to ensure all WAL contents are checkpointed to main DB
                this.diskDb.exec('PRAGMA wal_checkpoint(FULL);', (err) => {
                    if (err) {
                        console.error('❌ WAL checkpoint failed:', err.message);
                        return res.status(500).json({ success: false, error: err.message });
                    }
                    res.json({ success: true, message: 'WAL checkpoint completed', timestamp: new Date().toISOString() });
                });
        });

        // Force refresh global pool (for debugging/testing)
        this.app.post('/refresh-pool', (req, res) => {
            console.log('🔥 Manual pool refresh requested via API');
            const prevSize = this.globalParcelPool.length;
            
            this.maybeRefreshGlobalPool(true);
            
            res.json({
                success: true,
                message: `Pool refresh initiated`,
                previousSize: prevSize,
                timestamp: new Date().toISOString()
            });
        });

        // Get simple loading/progress info (disk only)
        this.app.get('/loading-progress', (req, res) => {
            this.db.get('SELECT COUNT(*) as owners_count FROM owner_data', [], (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                const owners = row.owners_count || 0;
                this.db.get('SELECT COUNT(*) as total FROM salt_lake_county_lir_parcels', [], (err2, totalRow) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    const total = totalRow.total || 0;
                    const percentage = total > 0 ? ((owners / total) * 100).toFixed(2) : '100.00';
                    res.json({ owners, total, percentage, status: owners >= total ? 'complete' : 'in-progress' });
                });
            });
        });

        // Get individual worker stats
        this.app.get('/worker-stats/:workerId', (req, res) => {
            const workerId = req.params.workerId;
            
            this.db.get(
                'SELECT COUNT(*) as processed FROM owner_data WHERE worker_id = ?',
                [workerId],
                (err, row) => {
                    if (err) {
                        res.status(500).json({ error: err.message });
                    } else {
                        res.json({
                            worker_id: workerId,
                            processed: row.processed || 0,
                            source: 'disk-database'
                        });
                    }
                }
            );
        });

        // Bulk worker stats (unique worker_ids)
        this.app.get('/worker-stats', (req, res) => {
            const sql = `SELECT worker_id, COUNT(*) as processed FROM owner_data WHERE worker_id IS NOT NULL GROUP BY worker_id ORDER BY processed DESC`;
            this.db.all(sql, [], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(rows.map(r => ({ worker_id: r.worker_id, processed: r.processed })));
            });
        });

        // POST runtime metrics snapshot from worker (authenticated)
        this.app.post('/runtime', this.authenticate.bind(this), (req, res) => {
            try {
                const body = req.body || {};
                const workerId = body.worker_id || body.workerId;
                if (!workerId) return res.status(400).json({ error: 'worker_id required' });
                // get processed count fast (non-blocking main logic)
                this.db.get('SELECT COUNT(*) as processed FROM owner_data WHERE worker_id = ?', [workerId], (err, row) => {
                    const processed = err ? undefined : row.processed;
                    const snapshot = {
                        worker_id: workerId,
                        processed,
                        tokens: body.tokens,
                        capacity: body.capacity,
                        refillRatePerSec: body.refillRatePerSec,
                        currentConcurrency: body.currentConcurrency,
                        emaLatencyMs: body.emaLatencyMs,
                        requestsPerMin: body.requestsPerMin,
                        parcelsPerMin: body.parcelsPerMin,
                        scalingFactor: body.scalingFactor,
                        microDelay: body.microDelay,
                        tokenTheoreticalParcelsPerMin: body.tokenTheoreticalParcelsPerMin,
                        latencyTheoreticalParcelsPerMin: body.latencyTheoreticalParcelsPerMin,
                        theoreticalParcelsPerMin: body.theoreticalParcelsPerMin, // effective theoretical
                        dynamicBatchSize: body.dynamicBatchSize,
                        inFlightRequests: body.inFlightRequests,
                        lastBatchDurationMs: body.lastBatchDurationMs,
                        localQueueLength: body.localQueueLength,
                        avgAllocationDelayMs: body.avgAllocationDelayMs,
                        prefetchAttempts: body.prefetchAttempts,
                        prefetchFetched: body.prefetchFetched,
                        version: body.version,
                        internalParallelism: body.internalParallelism,
                        pipelineOverlaps: body.pipelineOverlaps,
                        lastBatchOverlapMs: body.lastBatchOverlapMs,
                        avgBatchOverlapMs: body.avgBatchOverlapMs,
                        timestamp: body.timestamp || new Date().toISOString()
                    };
                    this.runtimeMetrics.set(workerId, snapshot);
                    return res.json({ success: true });
                });
            } catch (e) {
                console.error('❌ Error storing runtime metrics', e);
                return res.status(500).json({ error: 'runtime metrics store failed' });
            }
        });

        // GET all runtime metrics
        this.app.get('/runtime', (req, res) => {
            const all = Array.from(this.runtimeMetrics.values());
            res.json(all);
        });

        // GET runtime metrics for one worker
        this.app.get('/runtime/:workerId', (req, res) => {
            const w = this.runtimeMetrics.get(req.params.workerId);
            if (!w) return res.status(404).json({ error: 'not found' });
            res.json(w);
        });

        // Unified workers endpoint merges processed counts with runtime snapshots
        // Return top N workers (by processed) to avoid overwhelming the dashboard
        this.app.get('/workers', (req, res) => {
            const runtime = Array.from(this.runtimeMetrics.values());
            const runtimeMap = new Map(runtime.map(r => [r.worker_id, r]));
            const sql = `SELECT worker_id, COUNT(*) as processed FROM owner_data WHERE worker_id IS NOT NULL GROUP BY worker_id`;
            this.db.all(sql, [], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                const merged = rows.map(r => {
                    const snap = runtimeMap.get(r.worker_id) || {};
                                        const tokenTheo = snap.tokenTheoreticalParcelsPerMin;
                                        const latencyTheo = snap.latencyTheoreticalParcelsPerMin;
                                        const effectiveTheo = snap.theoreticalParcelsPerMin || (tokenTheo && latencyTheo ? Math.min(tokenTheo, latencyTheo) : (tokenTheo || latencyTheo));
                                        const parcelsPerMin = snap.parcelsPerMin;
                                        const utilization = (effectiveTheo && effectiveTheo > 0 && typeof parcelsPerMin === 'number')
                                            ? (parcelsPerMin / effectiveTheo)
                                            : null;
                                        const lastSeen = snap.timestamp ? new Date(snap.timestamp) : null;
                                        const heartbeatAge = lastSeen ? (Date.now() - lastSeen.getTime()) : null;
                                        const stale = heartbeatAge != null ? heartbeatAge > 10000 : null;
                    return {
                        worker_id: r.worker_id,
                        processed: r.processed,
                        tokens: snap.tokens,
                        capacity: snap.capacity,
                        refillRatePerSec: snap.refillRatePerSec,
                        currentConcurrency: snap.currentConcurrency,
                        emaLatencyMs: snap.emaLatencyMs,
                        internalParallelism: snap.internalParallelism,
                        pipelineOverlaps: snap.pipelineOverlaps,
                        lastBatchOverlapMs: snap.lastBatchOverlapMs,
                        avgBatchOverlapMs: snap.avgBatchOverlapMs,
                        internalParallelism: snap.internalParallelism,
                        pipelineOverlaps: snap.pipelineOverlaps,
                        lastBatchOverlapMs: snap.lastBatchOverlapMs,
                        avgBatchOverlapMs: snap.avgBatchOverlapMs,
                                                requestsPerMin: snap.requestsPerMin,
                                                parcelsPerMin,
                        scalingFactor: snap.scalingFactor,
                        microDelay: snap.microDelay,
                                                tokenTheoreticalParcelsPerMin: tokenTheo,
                                                latencyTheoreticalParcelsPerMin: latencyTheo,
                                                effectiveTheoreticalParcelsPerMin: effectiveTheo,
                                                theoreticalParcelsPerMin: effectiveTheo,
                                                utilization,
                                                heartbeatAge,
                                                stale,
                                                lastSeen: snap.timestamp,
                                                dynamicBatchSize: snap.dynamicBatchSize,
                                                inFlightRequests: snap.inFlightRequests,
                                                lastBatchDurationMs: snap.lastBatchDurationMs,
                                                localQueueLength: snap.localQueueLength,
                                                avgAllocationDelayMs: snap.avgAllocationDelayMs,
                                                version: snap.version
                    };
                });
                // Also include runtime-only workers that have not yet stored records
                for (const [wid, snap] of runtimeMap.entries()) {
                    if (!merged.find(m => m.worker_id === wid)) {
                                                const tokenTheo = snap.tokenTheoreticalParcelsPerMin;
                                                const latencyTheo = snap.latencyTheoreticalParcelsPerMin;
                                                const effectiveTheo = snap.theoreticalParcelsPerMin || (tokenTheo && latencyTheo ? Math.min(tokenTheo, latencyTheo) : (tokenTheo || latencyTheo));
                                                const parcelsPerMin = snap.parcelsPerMin;
                                                const utilization = (effectiveTheo && effectiveTheo > 0 && typeof parcelsPerMin === 'number')
                                                    ? (parcelsPerMin / effectiveTheo)
                                                    : null;
                                                const lastSeen = snap.timestamp ? new Date(snap.timestamp) : null;
                                                const heartbeatAge = lastSeen ? (Date.now() - lastSeen.getTime()) : null;
                                                const stale = heartbeatAge != null ? heartbeatAge > 10000 : null;
                        merged.push({
                            worker_id: wid,
                            processed: 0,
                            tokens: snap.tokens,
                            capacity: snap.capacity,
                            refillRatePerSec: snap.refillRatePerSec,
                            currentConcurrency: snap.currentConcurrency,
                            emaLatencyMs: snap.emaLatencyMs,
                            internalParallelism: snap.internalParallelism,
                            pipelineOverlaps: snap.pipelineOverlaps,
                            lastBatchOverlapMs: snap.lastBatchOverlapMs,
                            avgBatchOverlapMs: snap.avgBatchOverlapMs,
                            internalParallelism: snap.internalParallelism,
                            pipelineOverlaps: snap.pipelineOverlaps,
                            lastBatchOverlapMs: snap.lastBatchOverlapMs,
                            avgBatchOverlapMs: snap.avgBatchOverlapMs,
                                                        requestsPerMin: snap.requestsPerMin,
                                                        parcelsPerMin,
                            scalingFactor: snap.scalingFactor,
                            microDelay: snap.microDelay,
                                                        tokenTheoreticalParcelsPerMin: tokenTheo,
                                                        latencyTheoreticalParcelsPerMin: latencyTheo,
                                                        effectiveTheoreticalParcelsPerMin: effectiveTheo,
                                                        theoreticalParcelsPerMin: effectiveTheo,
                                                        utilization,
                                                        heartbeatAge,
                                                        stale,
                                                        lastSeen: snap.timestamp,
                                                        dynamicBatchSize: snap.dynamicBatchSize,
                                                        inFlightRequests: snap.inFlightRequests,
                                                        lastBatchDurationMs: snap.lastBatchDurationMs,
                                                        localQueueLength: snap.localQueueLength,
                                                        avgAllocationDelayMs: snap.avgAllocationDelayMs,
                                                        version: snap.version
                        });
                    }
                }
                // Sort by processed desc and return top 20
                const totalWorkers = merged.length;
                const sorted = merged.sort((a, b) => (b.processed || 0) - (a.processed || 0));
                const top = sorted.slice(0, 20);
                res.json({ workers: top, totalWorkers, truncatedCount: Math.max(0, totalWorkers - top.length) });
            });
        });

        // Allocation status overview
        this.app.get('/allocation-status', (req, res) => {
            const perWorker = {};
            for (const [wid, set] of this.workerAllocations.entries()) {
                perWorker[wid] = set.size;
            }
            res.json({
                poolSize: this.globalParcelPool.length,
                allocatedSize: this.allocatedParcels.size,
                workersWithAllocations: this.workerAllocations.size,
                perWorkerAllocations: perWorker,
                allocationStats: this.allocationStats,
                target: this.GLOBAL_POOL_TARGET,
                min: this.GLOBAL_POOL_MIN
            });
        });

        // Unified extended endpoint combining /workers + allocation status for dashboard convenience
        this.app.get('/workers-extended', (req, res) => {
            // Reuse logic by internally calling /workers handler (duplicate minimal code for simplicity)
            const runtime = Array.from(this.runtimeMetrics.values());
            const runtimeMap = new Map(runtime.map(r => [r.worker_id, r]));
            const sql = `SELECT worker_id, COUNT(*) as processed FROM owner_data WHERE worker_id IS NOT NULL GROUP BY worker_id`;
            this.db.all(sql, [], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                const merged = rows.map(r => {
                    const snap = runtimeMap.get(r.worker_id) || {};
                    const tokenTheo = snap.tokenTheoreticalParcelsPerMin;
                    const latencyTheo = snap.latencyTheoreticalParcelsPerMin;
                    const effectiveTheo = snap.theoreticalParcelsPerMin || (tokenTheo && latencyTheo ? Math.min(tokenTheo, latencyTheo) : (tokenTheo || latencyTheo));
                    const parcelsPerMin = snap.parcelsPerMin;
                    const utilization = (effectiveTheo && effectiveTheo > 0 && typeof parcelsPerMin === 'number')
                        ? (parcelsPerMin / effectiveTheo)
                        : null;
                    const lastSeen = snap.timestamp ? new Date(snap.timestamp) : null;
                    const heartbeatAge = lastSeen ? (Date.now() - lastSeen.getTime()) : null;
                    const stale = heartbeatAge != null ? heartbeatAge > 10000 : null;
                    return {
                        worker_id: r.worker_id,
                        processed: r.processed,
                        tokens: snap.tokens,
                        capacity: snap.capacity,
                        refillRatePerSec: snap.refillRatePerSec,
                        currentConcurrency: snap.currentConcurrency,
                        emaLatencyMs: snap.emaLatencyMs,
                        requestsPerMin: snap.requestsPerMin,
                        parcelsPerMin,
                        scalingFactor: snap.scalingFactor,
                        microDelay: snap.microDelay,
                        tokenTheoreticalParcelsPerMin: tokenTheo,
                        latencyTheoreticalParcelsPerMin: latencyTheo,
                        effectiveTheoreticalParcelsPerMin: effectiveTheo,
                        theoreticalParcelsPerMin: effectiveTheo,
                        utilization,
                        heartbeatAge,
                        stale,
                        lastSeen: snap.timestamp,
                        dynamicBatchSize: snap.dynamicBatchSize,
                        inFlightRequests: snap.inFlightRequests,
                        lastBatchDurationMs: snap.lastBatchDurationMs,
                        localQueueLength: snap.localQueueLength,
                        avgAllocationDelayMs: snap.avgAllocationDelayMs,
                        internalParallelism: snap.internalParallelism,
                        pipelineOverlaps: snap.pipelineOverlaps,
                        lastBatchOverlapMs: snap.lastBatchOverlapMs,
                        avgBatchOverlapMs: snap.avgBatchOverlapMs,
                        version: snap.version
                    };
                });
                for (const [wid, snap] of runtimeMap.entries()) {
                    if (!merged.find(m => m.worker_id === wid)) {
                        const tokenTheo = snap.tokenTheoreticalParcelsPerMin;
                        const latencyTheo = snap.latencyTheoreticalParcelsPerMin;
                        const effectiveTheo = snap.theoreticalParcelsPerMin || (tokenTheo && latencyTheo ? Math.min(tokenTheo, latencyTheo) : (tokenTheo || latencyTheo));
                        const parcelsPerMin = snap.parcelsPerMin;
                        const utilization = (effectiveTheo && effectiveTheo > 0 && typeof parcelsPerMin === 'number')
                            ? (parcelsPerMin / effectiveTheo)
                            : null;
                        const lastSeen = snap.timestamp ? new Date(snap.timestamp) : null;
                        const heartbeatAge = lastSeen ? (Date.now() - lastSeen.getTime()) : null;
                        const stale = heartbeatAge != null ? heartbeatAge > 10000 : null;
                        merged.push({
                            worker_id: wid,
                            processed: 0,
                            tokens: snap.tokens,
                            capacity: snap.capacity,
                            refillRatePerSec: snap.refillRatePerSec,
                            currentConcurrency: snap.currentConcurrency,
                            emaLatencyMs: snap.emaLatencyMs,
                            requestsPerMin: snap.requestsPerMin,
                            parcelsPerMin,
                            scalingFactor: snap.scalingFactor,
                            microDelay: snap.microDelay,
                            tokenTheoreticalParcelsPerMin: tokenTheo,
                            latencyTheoreticalParcelsPerMin: latencyTheo,
                            effectiveTheoreticalParcelsPerMin: effectiveTheo,
                            theoreticalParcelsPerMin: effectiveTheo,
                            utilization,
                            heartbeatAge,
                            stale,
                            lastSeen: snap.timestamp,
                            dynamicBatchSize: snap.dynamicBatchSize,
                            inFlightRequests: snap.inFlightRequests,
                            lastBatchDurationMs: snap.lastBatchDurationMs,
                            localQueueLength: snap.localQueueLength,
                            avgAllocationDelayMs: snap.avgAllocationDelayMs,
                            internalParallelism: snap.internalParallelism,
                            pipelineOverlaps: snap.pipelineOverlaps,
                            lastBatchOverlapMs: snap.lastBatchOverlapMs,
                            avgBatchOverlapMs: snap.avgBatchOverlapMs,
                            version: snap.version
                        });
                    }
                }
                    // Sort and return top 20 workers with allocation overlay
                    const totalWorkers = merged.length;
                    const sorted = merged.sort((a, b) => (b.processed || 0) - (a.processed || 0));
                    const top = sorted.slice(0, 20);
                    const perWorkerAlloc = {};
                    for (const [wid, set] of this.workerAllocations.entries()) perWorkerAlloc[wid] = set.size;
                    res.json({
                        workers: top,
                        totalWorkers,
                        truncatedCount: Math.max(0, totalWorkers - top.length),
                        allocation: {
                            poolSize: this.globalParcelPool.length,
                            allocatedSize: this.allocatedParcels.size,
                            perWorker: perWorkerAlloc,
                            stats: this.allocationStats,
                            target: this.GLOBAL_POOL_TARGET,
                            min: this.GLOBAL_POOL_MIN
                        }
                    });
            });
        });

        // Enhanced reallocate endpoint with expanded search, diagnostics, and global pool fallback
        this.app.get('/reallocate/:workerId/:count?', this.authenticate.bind(this), (req, res) => {
            const workerId = req.params.workerId;
            const count = parseInt(req.params.count) || 5;
            console.log(`🔄 Reallocation request from ${workerId} for ${count} parcels (allocatedSet=${this.allocatedParcels.size} poolSize=${this.globalParcelPool.length})`);
            this.allocationStats.reallocateRequests++;

            if (this.workerAllocations.has(workerId)) {
                const prev = this.workerAllocations.get(workerId);
                prev.forEach(pid => this.allocatedParcels.delete(pid));
                this.workerAllocations.delete(workerId);
            }

            const failedQuery = `
                SELECT DISTINCT parcel_id
                FROM owner_data
                WHERE owner_name IS NULL
                AND created_at > datetime('now', '-2 hours')
                AND parcel_id NOT IN (
                    SELECT parcel_id FROM owner_data WHERE owner_name IS NULL GROUP BY parcel_id HAVING COUNT(*) >= 3
                )
                ORDER BY created_at DESC
                LIMIT ?`;

            this.db.all(failedQuery, [count * 2], (err, failedRows) => {
                if (err) {
                    console.error('❌ Database error getting failed parcels:', err.message);
                    return res.status(500).json({ error: 'Database error' });
                }
                const availableFailed = failedRows.map(r => r.parcel_id).filter(pid => !this.allocatedParcels.has(pid)).slice(0, count);
                if (availableFailed.length > 0) {
                    availableFailed.forEach(pid => this.allocatedParcels.add(pid));
                    this.workerAllocations.set(workerId, new Set(availableFailed));
                    this.allocationStats.reallocateServed += availableFailed.length;
                    this.allocationStats.totalAllocations += availableFailed.length;
                    console.log(`🔄 Allocated ${availableFailed.length} failed parcels to ${workerId}`);
                    return res.json({ worker_id: workerId, parcel_ids: availableFailed, type: 'retry_failed', count: availableFailed.length });
                }

                const freshQuery = `
                    SELECT slc.PARCEL_ID as parcel_id
                    FROM salt_lake_county_lir_parcels slc
                    LEFT JOIN owner_data od ON slc.PARCEL_ID = od.parcel_id
                    WHERE od.parcel_id IS NULL 
                       OR od.owner_name IS NULL 
                       OR od.owner_name = ''
                    ORDER BY slc.PARCEL_ID
                    LIMIT ?`;

                // First pass wider scan
                this.db.all(freshQuery, [count * 40], (err2, freshRows) => {
                    if (err2) {
                        console.error('❌ Database error getting fresh parcels:', err2.message);
                        return res.status(500).json({ error: 'Database error' });
                    }
                    const allocatedHits = freshRows.filter(r => this.allocatedParcels.has(r.parcel_id)).length;
                    const availableFresh = freshRows.map(r => r.parcel_id).filter(pid => !this.allocatedParcels.has(pid)).slice(0, count);
                    console.log(`🔍 Fresh scan pass1 candidates=${freshRows.length} allocatedHits=${allocatedHits} serveable=${availableFresh.length}`);
                    if (availableFresh.length > 0) {
                        availableFresh.forEach(pid => this.allocatedParcels.add(pid));
                        this.workerAllocations.set(workerId, new Set(availableFresh));
                        this.allocationStats.reallocateServed += availableFresh.length;
                        this.allocationStats.totalAllocations += availableFresh.length;
                        console.log(`🆕 Allocated ${availableFresh.length} fresh parcels to ${workerId} (${this.allocatedParcels.size} total allocated)`);
                        return res.json({ worker_id: workerId, parcel_ids: availableFresh, type: 'fresh', count: availableFresh.length });
                    }

                    // Expanded search if all filtered
                    if (freshRows.length > 0 && allocatedHits === freshRows.length) {
                        console.log(`🔁 Expanding search for ${workerId} (all ${freshRows.length} were allocated)`);
                        this.db.all(freshQuery, [count * 200], (err3, freshRows2) => {
                            if (err3) {
                                console.error('❌ Database error expanded fresh search:', err3.message);
                                return res.status(500).json({ error: 'Database error' });
                            }
                            const second = freshRows2.map(r => r.parcel_id).filter(pid => !this.allocatedParcels.has(pid)).slice(0, count);
                            if (second.length > 0) {
                                second.forEach(pid => this.allocatedParcels.add(pid));
                                this.workerAllocations.set(workerId, new Set(second));
                                this.allocationStats.reallocateServed += second.length;
                                this.allocationStats.totalAllocations += second.length;
                                console.log(`🆕 Allocated ${second.length} fresh parcels (expanded) to ${workerId}`);
                                return res.json({ worker_id: workerId, parcel_ids: second, type: 'fresh_expanded', count: second.length });
                            }
                            // Fallback to global pool
                            if (this.globalParcelPool.length > 0) {
                                const fromPool = this.globalParcelPool.splice(0, Math.min(count, this.globalParcelPool.length));
                                fromPool.forEach(pid => this.allocatedParcels.add(pid));
                                this.workerAllocations.set(workerId, new Set(fromPool));
                                this.allocationStats.totalAllocations += fromPool.length;
                                this.allocationStats.totalGlobalServed += fromPool.length;
                                console.log(`🌐 Fallback allocated ${fromPool.length} from global pool to ${workerId} (pool now ${this.globalParcelPool.length})`);
                                return res.json({ worker_id: workerId, parcel_ids: fromPool, type: 'global_pool_fallback', count: fromPool.length });
                            }
                            console.log(`⚠️ No parcels found for ${workerId} after expanded search (allocatedSet=${this.allocatedParcels.size})`);
                            this.maybeRefreshGlobalPool();
                            return res.json({ worker_id: workerId, parcel_ids: [], type: 'none', count: 0 });
                        });
                        return; // wait for expanded search
                    }

                    // Final fallback to global pool even if no candidates in first pass
                    if (this.globalParcelPool.length > 0) {
                        const fromPool = this.globalParcelPool.splice(0, Math.min(count, this.globalParcelPool.length));
                        fromPool.forEach(pid => this.allocatedParcels.add(pid));
                        this.workerAllocations.set(workerId, new Set(fromPool));
                        this.allocationStats.totalAllocations += fromPool.length;
                        this.allocationStats.totalGlobalServed += fromPool.length;
                        console.log(`🌐 Final fallback allocated ${fromPool.length} from global pool to ${workerId} (pool now ${this.globalParcelPool.length})`);
                        return res.json({ worker_id: workerId, parcel_ids: fromPool, type: 'global_pool_fallback', count: fromPool.length });
                    }

                    console.log(`⚠️ No fresh or failed parcels available for ${workerId} (allocatedSet=${this.allocatedParcels.size}, pass1Candidates=${freshRows.length})`);
                    
                    // Force aggressive refresh if pool is empty or stale
                    if (this.globalParcelPool.length < this.GLOBAL_POOL_MIN) {
                        console.log(`🔄 Forcing aggressive pool refresh (current size: ${this.globalParcelPool.length})`);
                        this.maybeRefreshGlobalPool(true);
                    }
                    
                    return res.json({ worker_id: workerId, parcel_ids: [], type: 'none', count: 0 });
                });
            });
        });

        // Global allocation endpoint for fair distribution of unprocessed parcels
        this.app.get('/global-allocate/:workerId/:count?', this.authenticate.bind(this), (req, res) => {
            const workerId = req.params.workerId;
            const count = parseInt(req.params.count) || 10;
            this.allocationStats.globalAllocationRequests++;

            if (this.globalParcelPool.length < count) {
                // Attempt opportunistic refresh (async)
                this.maybeRefreshGlobalPool();
            }

            if (this.globalParcelPool.length === 0) {
                this.allocationStats.poolHitsEmpty++;
                return res.json({ worker_id: workerId, parcel_ids: [], type: 'global_pool_empty', count: 0 });
            }

            const actual = Math.min(count, this.globalParcelPool.length);
            const allocated = this.globalParcelPool.splice(0, actual);
            // Track allocations
            allocated.forEach(pid => this.allocatedParcels.add(pid));
            this.workerAllocations.set(workerId, new Set(allocated));
            this.allocationStats.totalAllocations += allocated.length;
            this.allocationStats.totalGlobalServed += allocated.length;
            console.log(`🌐 Global allocate -> ${workerId} : ${allocated.length} parcels (pool now ${this.globalParcelPool.length})`);

            res.json({
                worker_id: workerId,
                parcel_ids: allocated,
                type: 'global_pool',
                count: allocated.length,
                remainingPool: this.globalParcelPool.length
            });
        });

        // Dynamic config endpoints (secured)
        this.app.get('/config', (req, res) => {
            res.json({ config: this.dynamicConfig });
        });
        this.app.put('/config', this.authenticate.bind(this), (req, res) => {
            const body = req.body || {};
            const allowedKeys = ['INTERNAL_PARALLEL', 'PIPELINE_TRIGGER_FRACTION'];
            let updated = {};
            for (const k of allowedKeys) {
                if (body[k] !== undefined) {
                    if (k === 'INTERNAL_PARALLEL') {
                        const v = parseInt(body[k]);
                        if (!isNaN(v) && v > 0 && v <= 32) {
                            this.dynamicConfig[k] = v;
                            updated[k] = v;
                        }
                    } else if (k === 'PIPELINE_TRIGGER_FRACTION') {
                        let f = parseFloat(body[k]);
                        if (!isNaN(f)) {
                            f = Math.min(0.95, Math.max(0.05, f));
                            this.dynamicConfig[k] = f;
                            updated[k] = f;
                        }
                    }
                }
            }
            return res.json({ success: true, updated, config: this.dynamicConfig });
        });
    }

    authenticate(req, res, next) {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const cfJwt = req.headers['cf-access-jwt-assertion'] || req.headers['cf-access-jwt'];
        const cfAccessConfigured = !!(CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET);

        console.log(`🔓 Cloudflare Access trusted; authHeader="${token}", cfJwtPresent=${!!cfJwt}, cfAccessConfigured=${cfAccessConfigured}`);

        return next();
    }

    connectDatabase() {
        if (!fs.existsSync(DB_PATH)) {
            console.error(`❌ Database file not found: ${DB_PATH}`);
            process.exit(1);
        }

        // Connect to disk database for persistence
        this.diskDb = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('❌ Error connecting to disk database:', err.message);
                process.exit(1);
            }
            console.log('✅ Connected to disk SQLite database');
        });

        // Use single disk-backed database for all operations (no in-memory DB)
        this.db = this.diskDb;
        // Apply optimizations / PRAGMA on disk DB and ensure tables exist
        this.optimizeDatabase();
        this.createTables();
    }

    optimizeDatabase() {
        console.log('🔧 Optimizing disk database for corruption resistance and concurrency...');

        if (!this.diskDb) return;

        // Use WAL for better concurrent access and durability
        this.diskDb.run('PRAGMA journal_mode = WAL', (err) => {
            if (err) console.error('❌ Error setting disk WAL mode:', err.message);
            else console.log('✅ Disk database WAL mode enabled');
        });

        // NORMAL synchronous for balance between performance and safety
        this.diskDb.run('PRAGMA synchronous = NORMAL', (err) => {
            if (err) console.error('❌ Error setting disk synchronous mode:', err.message);
            else console.log('✅ Disk database synchronous mode set to NORMAL');
        });

        // Cache size for disk operations
        this.diskDb.run('PRAGMA cache_size = 10000', (err) => {
            if (err) console.error('❌ Error setting disk cache size:', err.message);
            else console.log('✅ Disk database cache size set to 10000 pages');
        });

        // Enable foreign keys for integrity
        this.diskDb.run('PRAGMA foreign_keys = ON', (err) => {
            if (err) console.error('❌ Error enabling foreign keys:', err.message);
            else console.log('✅ Disk database foreign keys enabled');
        });

        // Set busy timeout for concurrent access
        this.diskDb.run('PRAGMA busy_timeout = 30000', (err) => {
            if (err) console.error('❌ Error setting busy timeout:', err.message);
            else console.log('✅ Disk database busy timeout set to 30 seconds');
        });

        console.log('🎯 Disk-backed database optimized for concurrent workers');
    }

    createTables() {
        const createOwnerTableSQL = `
            CREATE TABLE IF NOT EXISTS owner_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parcel_id TEXT NOT NULL,
                owner_name TEXT,
                property_address TEXT,
                total_acreage TEXT,
                property_type TEXT,
                market_value TEXT,
                market_value_year TEXT,
                worker_id TEXT,
                scraped_at TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(parcel_id)
            )
        `;

        const createParcelsTableSQL = `
            CREATE TABLE IF NOT EXISTS salt_lake_county_lir_parcels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                
                -- Administrative Fields
                OBJECTID INTEGER,
                COUNTY_NAME TEXT,
                COUNTY_ID TEXT,
                ASSESSOR_SRC TEXT,
                BOUNDARY_SRC TEXT,
                DISCLAIMER TEXT,
                CURRENT_ASOF TEXT,
                
                -- Parcel Identification
                PARCEL_ID TEXT NOT NULL,
                SERIAL_NUM TEXT,
                
                -- Address Information
                PARCEL_ADD TEXT,
                PARCEL_CITY TEXT,
                
                -- Tax Information
                TAXEXEMPT_TYPE TEXT,
                TAX_DISTRICT TEXT,
                
                -- Market Values
                TOTAL_MKT_VALUE REAL,
                LAND_MKT_VALUE REAL,
                
                -- Property Characteristics
                PARCEL_ACRES REAL,
                PROP_CLASS TEXT,
                PROP_TYPE TEXT,
                PRIMARY_RES TEXT,
                
                -- Housing Information
                HOUSE_CNT TEXT,
                SUBDIV_NAME TEXT,
                
                -- Building Information
                BLDG_SQFT REAL,
                BLDG_SQFT_INFO TEXT,
                FLOORS_CNT REAL,
                FLOORS_INFO TEXT,
                BUILT_YR INTEGER,
                EFFBUILT_YR INTEGER,
                CONST_MATERIAL TEXT,
                
                -- Import metadata
                import_timestamp TEXT,
                data_source TEXT
            )
        `;

        // Ensure tables exist on disk database (now our single authoritative DB)
        if (!this.db) return;

        this.db.run(createOwnerTableSQL, (err) => {
            if (err) {
                console.error('❌ Error creating owner_data table on disk:', err.message);
            } else {
                console.log('✅ Owner data table ready on disk');
                // Create indexes for owner_data
                this.db.run('CREATE INDEX IF NOT EXISTS idx_owner_parcel_id ON owner_data(parcel_id)');
                this.db.run('CREATE INDEX IF NOT EXISTS idx_owner_scraped_at ON owner_data(scraped_at)');
            }
        });

        this.db.run(createParcelsTableSQL, (err) => {
            if (err) {
                console.error('❌ Error creating parcels table on disk:', err.message);
            } else {
                console.log('✅ Parcels table ready on disk');
                this.db.run('CREATE INDEX IF NOT EXISTS idx_slc_parcel_id ON salt_lake_county_lir_parcels(PARCEL_ID)');
                this.db.run('CREATE INDEX IF NOT EXISTS idx_slc_prop_type ON salt_lake_county_lir_parcels(PROP_TYPE)');
            }
        });
    }

    loadExistingData() {
        // Deprecated in disk-only mode - no-op
        console.log('ℹ️ loadExistingData called but running in disk-only mode (no in-memory load)');
    }
    

    startPeriodicFlush() {
        // Flush in-memory data to disk every 60 seconds
        const FLUSH_INTERVAL = 60 * 1000; // 60 seconds
        
        // Instead of flushing memory, periodically run WAL checkpoint to ensure data is checkpointed to main DB file
        setInterval(() => {
            if (!this.diskDb) return;
            this.diskDb.exec('PRAGMA wal_checkpoint(FULL);', (err) => {
                if (err) console.error('❌ Periodic WAL checkpoint failed:', err.message);
                else console.log('🧭 Periodic WAL checkpoint completed');
            });
        }, FLUSH_INTERVAL);

        console.log(`⏰ Periodic WAL checkpoint enabled (every ${FLUSH_INTERVAL/1000} seconds)`);
    }

    startPeriodicBackup() {
        // Create database backup every 30 minutes
        const BACKUP_INTERVAL = 30 * 60 * 1000; // 30 minutes
        
        setInterval(() => {
            this.createDatabaseBackup();
        }, BACKUP_INTERVAL);
        
        console.log(`💾 Periodic database backup enabled (every ${BACKUP_INTERVAL/60000} minutes)`);
    }

    createDatabaseBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.resolve(__dirname, `../backup_${timestamp}.db`);
        
        console.log('💾 Creating database backup...');
        
        // Copy database file for backup
        const fs = require('fs');
        fs.copyFile(DB_PATH, backupPath, (err) => {
            if (err) {
                console.error('❌ Failed to create backup:', err.message);
            } else {
                console.log(`✅ Database backup created: ${backupPath}`);
                
                // Clean up old backups (keep only last 5)
                this.cleanupOldBackups();
            }
        });
    }

    cleanupOldBackups() {
        const fs = require('fs');
        const glob = require('path').resolve;
        
        // This is a simple cleanup - in production you'd want more sophisticated logic
        fs.readdir(path.dirname(DB_PATH), (err, files) => {
            if (err) return;
            
            const backupFiles = files.filter(f => f.startsWith('backup_') && f.endsWith('.db'))
                                    .sort()
                                    .reverse(); // newest first
            
            // Remove backups older than the 5 most recent
            backupFiles.slice(5).forEach(file => {
                const filePath = path.resolve(path.dirname(DB_PATH), file);
                fs.unlink(filePath, (err) => {
                    if (!err) console.log(`🗑️ Removed old backup: ${file}`);
                });
            });
        });
    }

    flushMemoryToDisk() {
        // Deprecated: previously flushed in-memory DB to disk. In disk-only mode this is a no-op.
        console.log('ℹ️ flushMemoryToDisk called but running in disk-only mode; use /flush endpoint to run a WAL checkpoint if needed');
    }

    clearMemoryAfterFlush() {
        // No-op in disk-only mode
        console.log('ℹ️ clearMemoryAfterFlush called but running in disk-only mode (no-op)');
    }

    // Force flush all data immediately (useful for manual flushes)
    forceFlushAll() {
        console.log('ℹ️ forceFlushAll called; running WAL checkpoint on disk DB');
        if (this.diskDb) {
            this.diskDb.exec('PRAGMA wal_checkpoint(FULL);', (err) => {
                if (err) console.error('❌ force WAL checkpoint failed:', err.message);
                else console.log('✅ force WAL checkpoint completed');
            });
        }
    }

    // (Old collectData removed - new implementation with batch support earlier in class)

    insertOwnerData(parcel_id, owner, worker_id, scraped_at, res) {
        // Simplified insert - just parcel_id and owner_name
        const insertSQL = `
            INSERT OR REPLACE INTO owner_data (
                parcel_id, owner_name, worker_id, scraped_at
            ) VALUES (?, ?, ?, ?)
        `;

        console.log(`💾 Executing simplified SQL insert for parcel: ${parcel_id}`);
        console.log(`📊 Insert values:`, [parcel_id, owner, worker_id, scraped_at]);
        if ('1' === '1') {
            console.log(`👤 Owner (single): parcel=${parcel_id} owner=${owner || 'NULL'}`);
        }

        // Log SQL (if enabled) before executing
        this.logSql(insertSQL, [parcel_id, owner, worker_id, scraped_at || new Date().toISOString()]);

        this.db.run(insertSQL, [
            parcel_id,
            owner,
            worker_id,
            scraped_at || new Date().toISOString()
        ], function(err) {
            if (err) {
                console.error('❌ Database error:', err.message);
                this.stats.totalErrors++;
                res.status(500).json({ error: 'Database error' });
            } else {
                this.stats.totalReceived++;
                this.stats.totalStored++;
                this.stats.lastReceived = new Date();
                
                // Clear allocation tracking for this parcel
                this.allocatedParcels.delete(parcel_id);
                
                // Find and clear worker allocation for this parcel
                for (const [workerId, allocatedParcels] of this.workerAllocations.entries()) {
                    if (allocatedParcels.has(parcel_id)) {
                        allocatedParcels.delete(parcel_id);
                        if (allocatedParcels.size === 0) {
                            this.workerAllocations.delete(workerId);
                        }
                        break;
                    }
                }
                
                // Always emit a clear stored message so it's easy to find in logs
                console.log(`✅ Stored data for parcel ${parcel_id} from ${worker_id}. Owner='${owner || 'NULL'}' Changes: ${this.changes}, Row ID: ${this.lastID}`);
                res.json({ 
                    success: true, 
                    parcel_id,
                    changes: this.changes,
                    lastID: this.lastID,
                    stored_at: new Date().toISOString()
                });
            }
        }.bind(this));
    }

    collectBatch(req, res) {
        const { records } = req.body;

        if (!Array.isArray(records)) {
            return res.status(400).json({ error: 'records array is required' });
        }

        console.log(`📦 Processing batch of ${records.length} records...`);
        
        // Use database transaction for better performance
        this.db.serialize(() => {
            this.db.run('BEGIN TRANSACTION');
            
            const insertSQL = `
                INSERT OR REPLACE INTO owner_data (
                    parcel_id, owner_name, property_address, total_acreage,
                    property_type, market_value, market_value_year,
                    worker_id, scraped_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const stmt = this.db.prepare(insertSQL);
            let completed = 0;
            let errors = 0;

            records.forEach(record => {
                const params = [
                    record.parcel_id,
                    record.owner,
                    record.address,
                    record.total_acreage,
                    record.property_type,
                    record.market_value,
                    record.market_value_year,
                    record.worker_id,
                    record.scraped_at
                ];
                // Log SQL for each record if enabled
                this.logSql(insertSQL, params);

                stmt.run(params, function(err) {
                    if (err) {
                        console.error(`❌ Error storing ${record.parcel_id}:`, err.message);
                        errors++;
                    } else {
                        completed++;
                        // Always log owner lines for visibility
                        console.log(`👤 Owner (batch): parcel=${record.parcel_id} owner=${record.owner || 'NULL'}`);
                    }
                });
            });

            stmt.finalize(() => {
                this.db.run('COMMIT', (err) => {
                    if (err) {
                        console.error('❌ Transaction commit failed:', err.message);
                        this.db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Transaction failed' });
                    }
                    
                    // Update stats
                    this.stats.totalReceived += records.length;
                    this.stats.totalStored += completed;
                    this.stats.totalErrors += errors;
                    this.stats.lastReceived = new Date();

                    console.log(`✅ Batch transaction completed: ${completed} stored, ${errors} errors`);
                    res.json({
                        success: true,
                        total: records.length,
                        stored: completed,
                        errors: errors,
                        performance: 'optimized'
                    });
                });
            });
        });
    }

    start() {
        this.app.listen(PORT, () => {
            console.log(`🚀 Data Collector Server running on port ${PORT}`);
            console.log(`📊 Disk Database: ${DB_PATH}`);
            console.log(`🏎️  Using disk-backed SQLite database (no in-memory DB)`);
            console.log(`🔐 Trusting Cloudflare Access (client headers configured: ${!!(CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET)})`);
            console.log(`📡 Endpoint: http://localhost:${PORT}/collect`);
            console.log(`💾 Periodic WAL checkpoint: Every 60 seconds`);
        });
    }

    gracefulShutdown() {
        console.log('\n🛑 Graceful shutdown initiated...');
        console.log('💾 Final WAL checkpoint before shutdown...');
        
        // Clear allocation cleanup interval
        if (this.allocationCleanupInterval) {
            clearInterval(this.allocationCleanupInterval);
            console.log('✅ Allocation cleanup interval cleared');
        }
        
    // Force final WAL checkpoint before shutdown
    this.forceFlushAll();
        
        setTimeout(() => {
            console.log('✅ Final flush completed');
            if (this.db) {
                this.db.close();
                console.log('✅ Database connection closed');
            }
            console.log('🏁 Shutdown complete');
            process.exit(0);
        }, 2000); // Wait 2 seconds for flush to complete
    }
}

// Start server
if (require.main === module) {
    const collector = new DataCollector();
    collector.start();

    // Graceful shutdown with data flush
    process.on('SIGINT', () => {
        collector.gracefulShutdown();
    });

    process.on('SIGTERM', () => {
        collector.gracefulShutdown();
    });
}

module.exports = DataCollector;
