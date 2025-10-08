/**
 * Salt Lake County Property Owner Scraper - INDEPENDENT VERSION v2.1
 * Enhanced Cloudflare Worker with advanced anti-detection, worker independence, and comprehensive rate limiting
 * Uses Context7 techniques for maximum performance while preventing HTTP 520 errors
 */

// Global rate limiting state per worker instance
let workerState = {
  requestCount: 0,
  lastRequestTime: 0,
  consecutiveErrors: 0,
  lastErrorTime: 0,
  backoffUntil: 0,
  http520Count: 0,
  recentRequestTimestamps: [], // for dynamic requests/min
  recentParcelCompletions: [], // timestamps for parcels completed
  // Token bucket (initial conservative values; will be tuned later)
  tokenBucket: {
    capacity: 240,            // higher initial burst capacity for faster start
    tokens: 240,
    refillRatePerSec: 60,     // more aggressive starting refill to accelerate ramp
    lastRefill: Date.now()
  },
  // Metrics skeleton for future adaptive control loop
  metrics: {
    successfulParcels: 0,
    failedParcels: 0,
    emaLatency: null,
    recent520s: [],
    statusWindow: [],          // sliding window of statuses {t, ok, code}
    latencySamples: [],        // recent latency samples
    adjustmentHistory: [],
    safeModeUntil: 0,
    currentConcurrency: 4,
    microDelay: 10,            // Reduced from 40ms to 10ms for higher throughput
    requestRateWindow: [],     // timestamps of requests (for per-minute calc)
    parcelRateWindow: [],      // timestamps of completed parcels (for per-minute calc)
    lastAction: 'init'
  }
  ,
  // Prefetch queue for parcel IDs to reduce allocation latency gaps
  localParcelQueue: [],           // queued parcel_ids ready for processing
  prefetchInFlight: false         // guard to prevent overlapping reallocate calls
};

// Optional patch (startup initialization for internal parallelism - proposal #1)
// Provide a default internalParallelism so first runtime snapshot includes it even before first batch.
workerState.metrics.internalParallelism = 4; // will be overridden after config/env evaluation in first batch
workerState.metrics.pipelineOverlaps = 0;
workerState.metrics.lastBatchOverlapMs = null;
workerState.metrics.avgBatchOverlapMs = null;

// Dynamic batch parameters (initialized later)
workerState.dynamicBatchSize = 4;
workerState.autonomousLoopStarted = false;
workerState.inFlightRequests = 0;
workerState.lastBatchDurationMs = null;
workerState.lastBatchEndTime = null;           // timestamp when last batch finished
workerState.lastAutonomousTickStart = null;    // timestamp at start of tick (before processing)
workerState.avgAllocationDelayMs = null;       // moving average of delay between batch end and next batch start
// Prefetch instrumentation
workerState.prefetchAttempts = 0;              // count of maybePrefetchParcels invocations that proceeded
workerState.prefetchFetched = 0;               // total parcel ids fetched into queue
workerState.bootstrapPrefetchDone = false;     // flag after initial deep prefetch seeding

function startAutonomousLoop(env) {
  // Continuous mode defaults ON; only disable when CONTINUOUS explicitly '0'
  const continuousEnabled = env.CONTINUOUS !== '0';
  if (!continuousEnabled) {
    debugLog(3, env, '⏹️ Continuous mode disabled by env.CONTINUOUS=0');
  }
  if (workerState.autonomousLoopStarted || !continuousEnabled) return;
  workerState.autonomousLoopStarted = true;
  console.log('🤖 Autonomous loop bootstrap starting');
  // Early metrics push (proposal #1) so dashboard sees baseline internalParallelism even before first batch
  try { sendRuntimeMetrics(env); } catch (_) {}
  // Force two early prefetch bursts to seed queue regardless of MIN_QUEUE
  (async () => {
    try {
      await forceBootstrapPrefetch(env, 'bootstrap-1');
      setTimeout(() => forceBootstrapPrefetch(env, 'bootstrap-2'), 1200);
    } catch (e) {
      debugLog(2, env, 'Bootstrap prefetch error:', e.message);
    }
  })();
    // Kick off dynamic config polling (non-blocking)
    try { 
      startDynamicConfigPolling(env); 
      console.log('🔄 Dynamic config polling started');
    } catch (e) { 
      console.log('❗ Config polling failed to start:', e.message); 
    }
  const tick = async () => {
    workerState.lastAutonomousTickStart = Date.now();
    try {
      // Prefetch if needed
      await maybePrefetchParcels(env);
      // If queue has enough parcels, launch a batch internally
      const batchSize = Math.min(workerState.dynamicBatchSize, workerState.localParcelQueue.length);
      if (batchSize > 0) {
        const ids = dequeueParcels(batchSize);
        workerState.inFlightRequests++;
        const batchStart = Date.now();
        // Reuse existing batch handler logic via internal request
        await handleBatchRequest(new Request('https://internal/batch', { method: 'POST', body: JSON.stringify({ parcel_ids: ids, worker_id: env.WORKER_ID }), headers: { 'Content-Type': 'application/json' } }), env);
        workerState.lastBatchDurationMs = Date.now() - batchStart;
        // Allocation delay measurement: time between last batch end and this batch start
        if (workerState.lastBatchEndTime) {
          const delay = batchStart - workerState.lastBatchEndTime;
          if (delay >= 0) {
            if (workerState.avgAllocationDelayMs == null) workerState.avgAllocationDelayMs = delay;
            else workerState.avgAllocationDelayMs = Math.round(workerState.avgAllocationDelayMs * 0.8 + delay * 0.2); // EMA
          }
        }
        workerState.lastBatchEndTime = Date.now();
        workerState.inFlightRequests--;
      }
    } catch (e) {
      console.log('⚠️ Autonomous loop error:', e.message);
    } finally {
      // Adaptive scheduling: base on latency & concurrency
      const m = workerState.metrics;
      const ema = m.emaLatency || 1200;
      const conc = Math.max(1, m.currentConcurrency || 1);
      // Reduced minimum delay from 300ms to 50ms for higher throughput
      const targetInterval = Math.max(50, Math.round((ema / conc) * 0.9));
      setTimeout(tick, targetInterval + Math.round(Math.random()*150));
    }
  };
  tick();
}

// Rate limiting configuration - Aggressively optimized for higher throughput
const RATE_LIMITS = {
  MIN_REQUEST_INTERVAL: 30,        // allow tighter bursts
  MAX_REQUESTS_PER_MINUTE: 200000, // effectively disabled
  ERROR_BACKOFF_MULTIPLIER: 1.25,
  MAX_CONSECUTIVE_ERRORS: 8,
  HTTP_520_BACKOFF: 12000,         // rely on safe mode + dynamic cuts
  RESET_ERROR_COUNT_AFTER: 120000  // 2 minutes
};

// Debug logging helper
// Levels: 0 = silent, 1 = errors, 2 = warnings, 3 = info, 4 = verbose/debug
function getDebugLevel(env) {
  if (!env || !env.DEBUG_LEVEL) return 3; // default to info
  const n = parseInt(env.DEBUG_LEVEL, 10);
  if (isNaN(n)) return 3;
  return Math.max(0, Math.min(4, n));
}

function debugLog(level, env, ...args) {
  try {
    const current = getDebugLevel(env);
    if (current >= level) {
      // Level to prefix map
      const prefixMap = {
        1: '❗',
        2: '⚠️',
        3: 'ℹ️',
        4: '🔍'
      };
      const prefix = prefixMap[level] || '';
      console.log(prefix, ...args);
    }
  } catch (e) {
    // Fallback to console.log silently
    console.log(...args);
  }
}

// Prefetch configuration (tuned for deeper buffering to reduce idle gaps)
const PREFETCH = {
  MIN_QUEUE: 4,       // trigger prefetch sooner (allow some drain before refill)
  TARGET_QUEUE: 48,   // keep a deeper local buffer to smooth allocation latency
  MAX_BATCH: 64       // allow larger single allocation requests
};

async function maybePrefetchParcels(env) {
  try {
    const continuousEnabled = env.CONTINUOUS !== '0';
    if (!continuousEnabled) {
      debugLog(4, env, 'Prefetch skip: continuous mode disabled (CONTINUOUS=0)');
      return;
    }
    if (workerState.prefetchInFlight) {
      debugLog(4, env, 'Prefetch skip: prefetch already in flight');
      return;
    }
    const qlen = workerState.localParcelQueue.length;
    if (qlen >= PREFETCH.MIN_QUEUE) {
      debugLog(4, env, `Prefetch skip: queue length ${qlen} >= MIN_QUEUE ${PREFETCH.MIN_QUEUE}`);
      return; // sufficient buffer
    }
    workerState.prefetchInFlight = true;
    workerState.prefetchAttempts++;
  // Ask for at least 16 to amortize allocation overhead; cap at MAX_BATCH and remaining to target
  let need = Math.min(PREFETCH.MAX_BATCH, PREFETCH.TARGET_QUEUE - qlen);
  if (need < 16) need = Math.min(16, PREFETCH.MAX_BATCH); // ensure a meaningful fetch size early
    const wid = env.WORKER_ID || 'unknown';
    const base = resolveCollectorBase(env);
    const url = `${base}/reallocate/${wid}/${need}`;
    debugLog(3, env, `🔄 Prefetch requesting ${need} parcels (queue=${qlen})`);
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${env.COLLECTOR_TOKEN || 'your-secure-token-here'}`
      }
    });
    if (!resp.ok) {
      debugLog(2, env, `Prefetch failed status=${resp.status}`);
      // fallback to global allocate endpoint
      await attemptGlobalAllocate(env, need, qlen);
      return;
    }
    const data = await resp.json();
    if (data && Array.isArray(data.parcel_ids) && data.parcel_ids.length) {
      const before = workerState.localParcelQueue.length;
      for (const id of data.parcel_ids) {
        // Avoid duplicates in queue
        if (!workerState.localParcelQueue.includes(id)) {
          workerState.localParcelQueue.push(id);
        }
      }
      debugLog(3, env, `📦 Prefetched ${workerState.localParcelQueue.length - before} new parcels (queue now ${workerState.localParcelQueue.length})`);
      workerState.prefetchFetched += (workerState.localParcelQueue.length - before);
      // If we received fewer than requested and still below target, immediately attempt global remainder
      const shortfall = need - (workerState.localParcelQueue.length - before);
      const stillBelowTarget = workerState.localParcelQueue.length < PREFETCH.TARGET_QUEUE;
      if (shortfall > 0 && stillBelowTarget) {
        debugLog(3, env, `⚡ Shortfall of ${shortfall} (asked ${need}) attempting immediate global remainder`);
        await attemptGlobalAllocate(env, Math.min(shortfall, PREFETCH.MAX_BATCH), workerState.localParcelQueue.length);
      }
    } else {
      debugLog(3, env, 'Prefetch returned no parcel_ids from reallocate; trying global pool');
      await attemptGlobalAllocate(env, need, qlen);
    }
  } catch (e) {
    debugLog(2, env, `Prefetch error: ${e.message}`);
  } finally {
    workerState.prefetchInFlight = false;
  }
}

// Forced prefetch ignoring current queue length (bootstrap only)
async function forceBootstrapPrefetch(env, label) {
  if (workerState.bootstrapPrefetchDone && label !== 'bootstrap-2') return;
  const base = resolveCollectorBase(env);
  const wid = env.WORKER_ID || 'unknown';
  const ask = Math.min(PREFETCH.MAX_BATCH, PREFETCH.TARGET_QUEUE);
  debugLog(3, env, `🚀 ${label}: forcing bootstrap prefetch ask=${ask}`);
  try {
    const resp = await fetch(`${base}/reallocate/${wid}/${ask}`, { headers: { 'Authorization': `Bearer ${env.COLLECTOR_TOKEN || 'your-secure-token-here'}` }});
    if (!resp.ok) {
      debugLog(2, env, `${label} reallocate failed status=${resp.status}; trying global`);
      await attemptGlobalAllocate(env, ask, workerState.localParcelQueue.length);
      return;
    }
    const data = await resp.json();
    if (data && Array.isArray(data.parcel_ids) && data.parcel_ids.length) {
      const before = workerState.localParcelQueue.length;
      for (const id of data.parcel_ids) {
        if (!workerState.localParcelQueue.includes(id)) workerState.localParcelQueue.push(id);
      }
      const added = workerState.localParcelQueue.length - before;
      workerState.prefetchFetched += added;
      debugLog(3, env, `🚀 ${label}: added ${added} bootstrap parcels (queue=${workerState.localParcelQueue.length})`);
    } else {
      debugLog(3, env, `🚀 ${label}: no parcels from reallocate; attempting global`);
      await attemptGlobalAllocate(env, ask, workerState.localParcelQueue.length);
    }
  } catch (e) {
    debugLog(2, env, `${label} bootstrap error: ${e.message}`);
  } finally {
    if (label === 'bootstrap-2') workerState.bootstrapPrefetchDone = true;
  }
}

// Fallback to global pool endpoint when /reallocate yields nothing
async function attemptGlobalAllocate(env, need, existingQueueLen) {
  try {
    const base = resolveCollectorBase(env);
    const wid = env.WORKER_ID || 'unknown';
    const gUrl = `${base}/global-allocate/${wid}/${need}`;
    debugLog(3, env, `🌐 Attempting global allocate for ${need} (queue=${existingQueueLen})`);
    const resp = await fetch(gUrl, { headers: { 'Authorization': `Bearer ${env.COLLECTOR_TOKEN || 'your-secure-token-here'}` }});
    if (!resp.ok) {
      debugLog(2, env, `Global allocate failed status=${resp.status}`);
      return;
    }
    const data = await resp.json();
    if (data && Array.isArray(data.parcel_ids) && data.parcel_ids.length) {
      const before = workerState.localParcelQueue.length;
      for (const id of data.parcel_ids) {
        if (!workerState.localParcelQueue.includes(id)) {
          workerState.localParcelQueue.push(id);
        }
      }
      debugLog(3, env, `🌐 Added ${workerState.localParcelQueue.length - before} parcels from global pool (poolType=${data.type})`);
    } else {
      debugLog(3, env, `🌐 Global allocate returned none (type=${data && data.type})`);
    }
  } catch (e) {
    debugLog(2, env, `Global allocate error: ${e.message}`);
  }
}

function dequeueParcels(count) {
  if (count <= 0) return [];
  return workerState.localParcelQueue.splice(0, count);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Stash env globally for debugLog calls in helper-only contexts
    globalThis.__ENV_REF = env;

    // Lazy start control loop once per worker lifetime
    if (!workerState._controlLoopStarted) {
      startControlLoop();
      workerState._controlLoopStarted = true;
      // Start autonomous loop (self-bootstrap) if enabled
      startAutonomousLoop(env);
    }

    try {
      // Handle different endpoints
      switch (path) {
        case '/scrape':
          return await handleScrapeRequest(request, env);
        case '/status':
          return await handleStatusRequest(env);
        case '/batch':
          return await handleBatchRequest(request, env);
        case '/reallocate':
          return await handleReallocationRequest(request, env);
        default:
          return new Response('Salt Lake County Owner Scraper API v2.1 - Independent Worker\nRate Limited with HTTP 520 Protection\nData Storage: Local SQLite', { status: 200 });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Enhanced rate limiting that prevents HTTP 520 errors
 */
async function enforceRateLimit(operation = 'request') {
  // First, refill tokens based on elapsed time
  refillTokens();

  // Wait until we have at least 1 token (respect backoff & safe mode)
  while (!tryConsumeToken()) {
    await sleep(25 + Math.random() * 15); // small jitter while waiting for tokens
    refillTokens();
  }

  const now = Date.now();
  
  // Check if we're in a backoff period
  if (now < workerState.backoffUntil) {
    const waitTime = workerState.backoffUntil - now;
  debugLog(3, globalThis.__ENV_REF, `Rate limit backoff active, waiting ${waitTime}ms`);
    await sleep(waitTime);
  }
  
  // Legacy per-minute & min-interval restrictions removed (token bucket + concurrency governs pacing)
  
  // Add extra delay based on consecutive errors
  if (workerState.consecutiveErrors > 0) {
    const errorDelay = Math.min(
      RATE_LIMITS.MIN_REQUEST_INTERVAL * Math.pow(RATE_LIMITS.ERROR_BACKOFF_MULTIPLIER, workerState.consecutiveErrors),
      30000 // Max 30 seconds
    );
  debugLog(4, globalThis.__ENV_REF, `Error-based delay: ${errorDelay}ms (${workerState.consecutiveErrors} consecutive errors)`);
    await sleep(errorDelay);
  }
  
  // Update request tracking
  workerState.requestCount++;
  workerState.lastRequestTime = Date.now();
  workerState.recentRequestTimestamps.push(now);
  // Track request rate window (60s)
  const m = workerState.metrics;
  m.requestRateWindow.push(now);
  const reqWindowCut = now - 60000;
  while (m.requestRateWindow.length && m.requestRateWindow[0] < reqWindowCut) m.requestRateWindow.shift();
  // Trim > 60s
  const cutoff = now - 60000;
  if (workerState.recentRequestTimestamps.length > 1200) {
    workerState.recentRequestTimestamps = workerState.recentRequestTimestamps.filter(t => t >= cutoff);
  }
}

/**
 * Refill tokens based on elapsed time since last refill
 */
function refillTokens() {
  const bucket = workerState.tokenBucket;
  const now = Date.now();
  const elapsedMs = now - bucket.lastRefill;
  if (elapsedMs <= 0) return;
  const add = (elapsedMs / 1000) * bucket.refillRatePerSec;
  if (add > 0) {
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + add);
    bucket.lastRefill = now;
  }
}

/**
 * Attempt to consume a token. Returns true on success.
 */
function tryConsumeToken(count = 1) {
  const bucket = workerState.tokenBucket;
  if (bucket.tokens >= count) {
    bucket.tokens -= count;
    return true;
  }
  return false;
}

/**
 * Handle HTTP errors and update backoff state
 */
function handleHttpError(statusCode, parcelId) {
  const now = Date.now();
  
  // Track consecutive errors
  workerState.consecutiveErrors++;
  workerState.lastErrorTime = now;
  
  // Special handling for HTTP 520 errors
  if (statusCode === 520) {
    workerState.http520Count++;
  debugLog(2, globalThis.__ENV_REF, `HTTP 520 error detected for parcel ${parcelId} (total: ${workerState.http520Count})`);
    
    // Implement progressive backoff for 520 errors
    const backoffTime = RATE_LIMITS.HTTP_520_BACKOFF * Math.min(workerState.http520Count, 5);
    workerState.backoffUntil = now + backoffTime;
    
  debugLog(2, globalThis.__ENV_REF, `HTTP 520 backoff activated: ${backoffTime}ms`);
  }
  
  // General error backoff
  if (workerState.consecutiveErrors >= RATE_LIMITS.MAX_CONSECUTIVE_ERRORS) {
    const backoffTime = RATE_LIMITS.MIN_REQUEST_INTERVAL * Math.pow(2, workerState.consecutiveErrors);
    workerState.backoffUntil = Math.max(workerState.backoffUntil, now + backoffTime);
    
  debugLog(2, globalThis.__ENV_REF, `Extended backoff due to ${workerState.consecutiveErrors} consecutive errors: ${backoffTime}ms`);
  }
}

/**
 * Reset error tracking on success
 */
function handleHttpSuccess() {
  const now = Date.now();
  
  // Reset consecutive errors after successful requests
  if (workerState.consecutiveErrors > 0) {
  debugLog(3, globalThis.__ENV_REF, `Resetting error count after success (was ${workerState.consecutiveErrors})`);
    workerState.consecutiveErrors = 0;
  }
  
  // Reset HTTP 520 count after extended period of success
  if (now - workerState.lastErrorTime > RATE_LIMITS.RESET_ERROR_COUNT_AFTER) {
    workerState.http520Count = 0;
  }
}

/**
 * Handle single parcel scraping request with rate limiting
 */
async function handleScrapeRequest(request, env) {
  const url = new URL(request.url);
  const parcelId = url.searchParams.get('parcel_id');
  
  if (!parcelId) {
    return new Response(JSON.stringify({ error: 'parcel_id parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const ownerData = await scrapeParcelOwner(parcelId, env);
    
    // Send data to local collection server
    await sendToLocalServer(env, parcelId, ownerData);
    // Track parcel completion timestamp
    const nowTs = Date.now();
    workerState.recentParcelCompletions.push(nowTs);
    // Trim to last 60s
    const cutoffParcel = nowTs - 60000;
    if (workerState.recentParcelCompletions.length > 1200) {
      workerState.recentParcelCompletions = workerState.recentParcelCompletions.filter(t => t >= cutoffParcel);
    }

    return new Response(JSON.stringify({
      parcel_id: parcelId,
      ...ownerData,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to scrape parcel',
      parcel_id: parcelId,
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle batch scraping request with enhanced rate limiting and coordination
 */
async function handleBatchRequest(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const payload = await request.json();
  let { parcel_ids, worker_id = 'default', delay = 1000 } = payload;
  // If caller didn't provide parcel_ids explicitly and we're in continuous mode, draw from queue
  if ((!parcel_ids || !Array.isArray(parcel_ids) || parcel_ids.length === 0) && env.CONTINUOUS === '1') {
    if (workerState.localParcelQueue.length < PREFETCH.MIN_QUEUE) {
      await maybePrefetchParcels(env);
    }
    parcel_ids = dequeueParcels(Math.min(25, workerState.localParcelQueue.length));
  }
  if (!parcel_ids || !Array.isArray(parcel_ids) || parcel_ids.length === 0) {
    return new Response(JSON.stringify({ error: 'parcel_ids array required (queue empty)' }), { status: 400, headers: { 'Content-Type': 'application/json' }});
  }

  const results = [];
  const errors = [];
  const aggregatedPayloads = []; // accumulate payload objects for batch send
  const batchStartTime = Date.now();

  // Poll config before each batch to ensure fresh values
  try {
    const base = resolveCollectorBase(env);
    const token = env.COLLECTOR_TOKEN || env.COLLECTOR_BEARER || 'your-secure-token-here';
    const configResp = await fetch(`${base}/config`, { 
      headers: { 'Authorization': `Bearer ${token}` },
      method: 'GET'
    });
    if (configResp.ok) {
      const configData = await configResp.json();
      if (configData && configData.config) {
        const oldConfig = {...workerState.dynamicConfig};
        workerState.dynamicConfig = { ...workerState.dynamicConfig, ...configData.config };
        // Log config changes for debugging
        const changes = [];
        for (const k of Object.keys(configData.config)) {
          if (oldConfig[k] !== configData.config[k]) {
            changes.push(`${k}:${oldConfig[k]}→${configData.config[k]}`);
          }
        }
        if (changes.length > 0) {
          console.log('🔧 Config updated:', changes.join(', '));
        }
      }
    }
  } catch (e) {
    // Continue with existing config on error
  }

  // Determine internal parallelism (per-batch task fan-out) independent from adaptive currentConcurrency.
  // Rationale: currentConcurrency governs macro scheduling & token refill pacing; internalParallelism lets us overlap
  // network latency within a batch using the same token bucket (each task still consumes tokens) to raise utilization.
  const DEFAULT_INTERNAL_PARALLEL = 4;
  const MAX_INTERNAL_PARALLEL = 50; // increased safety upper bound for high-throughput scenarios
  // Determine desired parallelism from dynamic config first, then env, then default
  const desiredParallelRaw = (workerState.dynamicConfig && workerState.dynamicConfig.INTERNAL_PARALLEL != null)
    ? workerState.dynamicConfig.INTERNAL_PARALLEL
    : env.INTERNAL_PARALLEL;
  let internalParallelism = parseInt(desiredParallelRaw != null ? desiredParallelRaw : `${DEFAULT_INTERNAL_PARALLEL}`, 10);
  if (isNaN(internalParallelism) || internalParallelism <= 0) internalParallelism = DEFAULT_INTERNAL_PARALLEL;
  internalParallelism = Math.min(MAX_INTERNAL_PARALLEL, internalParallelism);
  // Allow at least current adaptive concurrency to avoid regression
  internalParallelism = Math.max(internalParallelism, workerState.metrics.currentConcurrency || 1);
  workerState.metrics.internalParallelism = internalParallelism;
  // Immediate metrics push so dashboard reflects change soon after config update
  sendRuntimeMetrics(env);

  // Process parcels with limited CONCURRENCY to raise throughput while maintaining spacing
  console.log(`🚀 Worker ${worker_id}: Starting rate-limited processing of ${parcel_ids.length} parcels (adaptiveConcurrency=${workerState.metrics.currentConcurrency}, internalParallelism=${internalParallelism})`);

  await enforceRateLimit('batch');

  // Use adaptive state
  const metrics = workerState.metrics;
  let active = 0;
  let index = 0;
  let microDelay = metrics.microDelay; // start with global microDelay
  const MICRO_DELAY_FLOOR = 15;
  const MICRO_DELAY_CEILING = 800;
  const SUCCESS_WINDOW = 10;
  let successStreak = 0;

  function maybeAdjustLocalDelays() {
    if (successStreak >= SUCCESS_WINDOW) {
      const old = microDelay;
      microDelay = Math.max(MICRO_DELAY_FLOOR, Math.round(microDelay * 0.9));
      if (old !== microDelay) console.log(`📉 Adaptive microDelay: ${old} -> ${microDelay}`);
      successStreak = 0;
    }
  }

  // Pipelining groundwork: when a sufficient portion of this batch has started, we can trigger prefetch of the next.
  // We'll mark the timestamp we first trigger an overlap for later metrics (completed in metrics task patch).
  let pipelineTriggered = false;
  // Use dynamic pipeline trigger fraction if fetched from config
  const PIPELINE_TRIGGER_FRACTION = (workerState.dynamicConfig?.PIPELINE_TRIGGER_FRACTION != null)
    ? workerState.dynamicConfig.PIPELINE_TRIGGER_FRACTION
    : 0.5; // default

  async function maybeTriggerPipelinePrefetch() {
    if (pipelineTriggered) return;
    const launched = index; // number already dispatched
    if (launched >= Math.ceil(parcel_ids.length * PIPELINE_TRIGGER_FRACTION)) {
      pipelineTriggered = true;
      // Fire & forget prefetch for next batch if queue depth below target (non-blocking)
      // Avoid awaiting to keep overlap; errors are logged inside maybePrefetchParcels.
      try {
        if (env.CONTINUOUS === '1') {
          // Heuristic: only prefetch if remaining queued parcels below half of TARGET_QUEUE
          if (workerState.localParcelQueue.length < (PREFETCH.TARGET_QUEUE / 2)) {
            maybePrefetchParcels(env);
            workerState.metrics.pipelineOverlaps = (workerState.metrics.pipelineOverlaps || 0) + 1;
            workerState.metrics.lastPipelineTrigger = Date.now();
          }
        }
      } catch (e) {
        console.warn('Pipeline prefetch trigger failed:', e.message);
      }
    }
  }

  async function runNext() {
    if (index >= parcel_ids.length) return;
    const localIndex = index++;
    const parcelId = parcel_ids[localIndex];
    active++;

    // Stagger launches
    if (localIndex > 0) {
      // Reduced stagger for higher throughput - only minimal jitter to prevent exact simultaneity
      const jitter = Math.random() * 5 + 2;
      await sleep(jitter);
    }

    try {
      // Consume an additional token per concurrent task start to prevent bursts
      refillTokens();
      while (!tryConsumeToken()) {
        await sleep(5 + Math.random() * 5); // Reduced from 15-25ms to 5-10ms
        refillTokens();
      }
      const ownerData = await scrapeParcelOwner(parcelId, env, localIndex);
      aggregatedPayloads.push({
        parcel_id: parcelId,
        owner: ownerData?.owner || null,
        address: ownerData?.address || null,
        total_acreage: ownerData?.total_acreage || null,
        property_type: ownerData?.property_type || null,
        market_value: ownerData?.market_value || null,
        market_value_year: ownerData?.market_value_year || null,
        worker_id: env.WORKER_ID,
        scraped_at: new Date().toISOString(),
        status: ownerData?.status || 'ok'
      });
      handleHttpSuccess();
      results.push({ parcel_id: parcelId, ...ownerData, processed_at: new Date().toISOString() });
      successStreak++;
      metrics.successfulParcels++;
      const doneTs = Date.now();
      workerState.recentParcelCompletions.push(doneTs);
      if (workerState.recentParcelCompletions.length > 2000) {
        const cutoff2 = doneTs - 60000;
        workerState.recentParcelCompletions = workerState.recentParcelCompletions.filter(t => t >= cutoff2);
      }
      maybeAdjustLocalDelays();
    } catch (error) {
      console.error(`❌ Error processing parcel ${parcelId}:`, error);
      let httpStatus = null;
      if (error.message.includes('HTTP 520')) {
        httpStatus = 520; handleHttpError(520, parcelId);
      } else if (error.message.includes('HTTP')) {
        const statusMatch = error.message.match(/HTTP (\d+)/); if (statusMatch) { httpStatus = parseInt(statusMatch[1]); handleHttpError(httpStatus, parcelId);} }
      microDelay = Math.min(Math.round(microDelay * 1.5 + 30), MICRO_DELAY_CEILING);
      successStreak = 0;
      metrics.failedParcels++;
      aggregatedPayloads.push({
        parcel_id: parcelId,
        owner: null,
        address: null,
        total_acreage: null,
        property_type: null,
        market_value: null,
        market_value_year: null,
        worker_id: env.WORKER_ID,
        scraped_at: new Date().toISOString(),
        status: 'error',
        error: error.message
      });
      errors.push({ parcel_id: parcelId, error: error.message, processed_at: new Date().toISOString() });
    } finally {
      active--;
      // Launch additional tasks while capacity remains
      if (index < parcel_ids.length && active < internalParallelism) {
        runNext();
      }
    }
  }

  // Prime initial fan-out up to internalParallelism (or batch size)
  const starters = Math.min(internalParallelism, parcel_ids.length);
  const startPromises = [];
  for (let s = 0; s < starters; s++) {
    startPromises.push(runNext());
  }
  // Don't await all - let them start asynchronously for faster launch

  // While tasks run, periodically evaluate pipeline trigger condition
  (async () => {
    while ((results.length + errors.length) < parcel_ids.length && !pipelineTriggered) {
      maybeTriggerPipelinePrefetch();
      await sleep(20); // Reduced from 40ms to 20ms for faster pipeline detection
    }
  })();

  // Wait for completion
  while (results.length + errors.length < parcel_ids.length) {
    await sleep(10); // Reduced from 25ms to 10ms for faster completion detection
  }

  // After processing batch, send aggregated payloads in a single request to reduce overhead
  if (aggregatedPayloads.length > 0) {
    try {
      await sendBatchToLocalServer(env, aggregatedPayloads);
    } catch (e) {
      console.error('❌ Failed batch send to local server, falling back to individual sends:', e.message);
      // Fallback: attempt individual sends (best-effort)
      for (const p of aggregatedPayloads) {
        try {
          await sendToLocalServer(env, p.parcel_id, p);
        } catch (inner) {
          /* swallow */
        }
      }
    }
  }

  const summary = {
    worker_id,
    total_processed: parcel_ids.length,
    successful: results.length,
    failed: errors.length,
    rate_limit_state: {
      consecutive_errors: workerState.consecutiveErrors,
      http_520_count: workerState.http520Count,
      last_request_time: workerState.lastRequestTime,
      backoff_until: workerState.backoffUntil
    },
    results,
    errors,
    completed_at: new Date().toISOString()
  };

  // Persist updated global microDelay (blend with local)
  metrics.microDelay = Math.round((metrics.microDelay * 0.6) + (microDelay * 0.4));
  // Compute pipeline overlap metrics if triggered
  if (workerState.metrics.lastPipelineTrigger) {
    const overlap = Date.now() - workerState.metrics.lastPipelineTrigger;
    workerState.metrics.lastBatchOverlapMs = overlap;
    workerState.metrics.avgBatchOverlapMs = workerState.metrics.avgBatchOverlapMs
      ? Math.round(workerState.metrics.avgBatchOverlapMs * 0.6 + overlap * 0.4)
      : overlap;
    // reset trigger timestamp so next batch measures fresh
    workerState.metrics.lastPipelineTrigger = 0;
  }
  console.log(`📊 Worker ${worker_id} completed: ${results.length} success, ${errors.length} failed (concurrency=${metrics.currentConcurrency} microDelay=${metrics.microDelay}ms)`);
  
  // Calculate and store batch duration
  workerState.lastBatchDurationMs = Date.now() - batchStartTime;
  
  // Queue-based continuous mode prefetch after finishing batch
  if (env.CONTINUOUS === '1') {
    maybePrefetchParcels(env);
  }
  if (env.CONTINUOUS === '1') {
    maybePrefetchParcels(env); // fire and forget
  }

  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Periodic dynamic config polling (idempotent). Called once on startup.
function startDynamicConfigPolling(env) {
  if (workerState.dynamicConfigPollingStarted) return;
  workerState.dynamicConfigPollingStarted = true;
  workerState.dynamicConfig = workerState.dynamicConfig || {};
  const interval = 10000; // 10s
  const base = resolveCollectorBase(env);
  const token = env.COLLECTOR_TOKEN || env.COLLECTOR_BEARER || 'your-secure-token-here';
  
  console.log(`🔧 Starting config polling: base=${base} token=${token.substring(0,10)}... interval=${interval}ms`);
  
  // Immediate first poll
  pollConfig();
  
  // Then set up interval
  setInterval(pollConfig, interval);
  
  async function pollConfig() {
    try {
      console.log(`📡 Polling config from ${base}/config`);
      const resp = await fetch(`${base}/config`, { 
        headers: { 'Authorization': `Bearer ${token}` },
        method: 'GET'
      });
      
      if (!resp.ok) {
        console.log(`⚠️ Config poll failed status=${resp.status} url=${base}/config token=${token.substring(0,10)}...`);
        return;
      }
      
      const data = await resp.json();
      console.log(`📄 Config response:`, JSON.stringify(data));
      
      if (data && data.config) {
        const cfg = data.config;
        // Shallow merge & track changes
        const beforeObj = { ...workerState.dynamicConfig };
        workerState.dynamicConfig = { ...workerState.dynamicConfig, ...cfg };
        const diffs = [];
        for (const k of Object.keys(workerState.dynamicConfig)) {
          if (beforeObj[k] !== workerState.dynamicConfig[k]) {
            diffs.push(`${k}:${beforeObj[k]}→${workerState.dynamicConfig[k]}`);
          }
        }
        if (diffs.length) {
          console.log('🔧 Dynamic config change:', diffs.join(', '));
        } else {
          console.log('✅ Config poll successful, no changes');
        }
      }
    } catch (e) {
      console.log('❗ Config poll error:', e.message);
    }
  }
}

/**
 * Handle reallocation request - get new parcels when current worker encounters too many failures
 */
async function handleReallocationRequest(request, env) {
  const workerId = env.WORKER_ID || 'unknown';
  const count = new URL(request.url).searchParams.get('count') || '5';
  
  try {
    const reallocationUrl = `http://localhost:3000/reallocate/${workerId}/${count}`;
    
    const response = await fetch(reallocationUrl, {
      headers: {
        'Authorization': `Bearer ${env.COLLECTOR_TOKEN || 'your-secure-token-here'}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Reallocation server error: ${response.status}`);
    }
    
    const reallocationData = await response.json();
    
    console.log(`🔄 Received ${reallocationData.count} parcels for reallocation (type: ${reallocationData.type})`);
    
    return new Response(JSON.stringify(reallocationData), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ Reallocation request failed:', error);
    return new Response(JSON.stringify({ 
      error: 'Reallocation failed', 
      message: error.message,
      parcel_ids: [],
      count: 0
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle status request with rate limiting information
 */
async function handleStatusRequest(env) {
  const m = workerState.metrics;
  const bucket = workerState.tokenBucket;
  const now = Date.now();
  const last520Ago = m.recent520s.length ? ((now - m.recent520s[m.recent520s.length - 1]) / 1000).toFixed(1) : null;
  const shortCut = now - 60 * 1000;
  const recent = m.statusWindow.filter(r => r.t >= shortCut);
  const errors = recent.filter(r => !r.ok).length;
  const errorRate = recent.length ? +(errors / recent.length).toFixed(4) : 0;
  // Compute throughput metrics
  const reqCutoff = now - 60000;
  workerState.recentRequestTimestamps = workerState.recentRequestTimestamps.filter(t => t >= reqCutoff);
  workerState.recentParcelCompletions = workerState.recentParcelCompletions.filter(t => t >= reqCutoff);
  const requestsPerMin = workerState.recentRequestTimestamps.length;
  const parcelsPerMin = workerState.recentParcelCompletions.length;
  const theoreticalParcelsPerMin = Math.round(bucket.refillRatePerSec * Math.max(1, m.currentConcurrency));
  const utilization = theoreticalParcelsPerMin ? +(parcelsPerMin / theoreticalParcelsPerMin).toFixed(3) : 0;
  return new Response(JSON.stringify({
    status: 'operational',
    version: '2.2-adaptive-phase1',
    worker_id: env.WORKER_ID || 'unknown',
    adaptive: {
      refillRatePerSec: bucket.refillRatePerSec,
      capacity: bucket.capacity,
      tokens: Math.round(bucket.tokens),
      concurrency: m.currentConcurrency,
      microDelay: m.microDelay,
      emaLatency: m.emaLatency ? Math.round(m.emaLatency) : null,
      successfulParcels: m.successfulParcels,
      failedParcels: m.failedParcels,
      last520AgoSec: last520Ago,
      recent520Count90s: m.recent520s.filter(ts => now - ts <= 90 * 1000).length,
      errorRate60s: errorRate,
      adjustmentHistory: m.adjustmentHistory.slice(-5),
      requestsPerMin,
      parcelsPerMin,
      theoreticalParcelsPerMin,
      utilization,
      lastAction: m.lastAction,
      controlLoopIntervalMs: 2500,
      internalParallelism: m.internalParallelism || null,
      pipelineOverlaps: m.pipelineOverlaps || 0,
      lastBatchOverlapMs: m.lastBatchOverlapMs || null,
      avgBatchOverlapMs: m.batchOverlapMs || null
    },
    legacy_limits: {
      min_request_interval: RATE_LIMITS.MIN_REQUEST_INTERVAL,
      max_requests_per_minute: RATE_LIMITS.MAX_REQUESTS_PER_MINUTE,
      consecutive_errors: workerState.consecutiveErrors,
      http_520_count: workerState.http520Count,
      backoff_until: workerState.backoffUntil,
      last_request_time: workerState.lastRequestTime
    },
    timestamp: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Scrape owner information with advanced fingerprinting, retry logic, and HTTP 520 protection
 */
async function scrapeParcelOwner(parcelId, env, requestIndex = 0, retryCount = 0) {
  const MAX_RETRIES = 3;
  const BASE_DELAY = 2000; // 2 seconds base delay

  // Helper to build primary valuation endpoint (HTML includes owner + valuation data)
  const valuationUrl = buildValuationUrl(parcelId);
  // Potential secondary endpoint (placeholder for future expansion, e.g., tax history / building info)
  // For now we keep a lightweight HEAD/fast request pattern that can be swapped out.
  const secondaryUrl = `https://apps.saltlakecounty.gov/assessor/new/`;

  try {
    const start = Date.now();
    // Generate unique request fingerprint for this specific request (shared across parallel fetches)
    const fingerprint = generateRequestFingerprint(env.WORKER_ID, requestIndex);

    // NOTE: Cloudflare Workers already leverage HTTP/2 + keep-alive. We primarily reduce per-call overhead by
    // reusing a single headers object & centralizing URL construction.
    const sharedHeaders = {
      'User-Agent': fingerprint.userAgent,
      'Accept': fingerprint.accept,
      'Accept-Language': fingerprint.acceptLanguage,
      'Accept-Encoding': fingerprint.acceptEncoding,
      'Connection': fingerprint.connection,
      'Cache-Control': fingerprint.cacheControl,
      'Sec-Fetch-Dest': fingerprint.secFetchDest,
      'Sec-Fetch-Mode': fingerprint.secFetchMode,
      'Sec-Fetch-Site': fingerprint.secFetchSite,
      'Sec-Ch-Ua': fingerprint.secChUa,
      'Sec-Ch-Ua-Mobile': fingerprint.secChUaMobile,
      'Sec-Ch-Ua-Platform': fingerprint.secChUaPlatform,
      'Upgrade-Insecure-Requests': '1',
      'DNT': fingerprint.dnt,
      'X-Forwarded-For': fingerprint.xForwardedFor,
      'X-Real-IP': fingerprint.xRealIp
    };

    // Execute valuation fetch + a secondary lightweight fetch concurrently.
    // If secondary fails we proceed; only the primary is critical.
    const valuationResp = await fetch(valuationUrl, { headers: sharedHeaders });

    // Increment per-request count (batch-level limiter only accounts once per batch)
    workerState.requestCount++;

    // Check for HTTP errors on primary valuation request that should trigger retry
    if (!valuationResp.ok) {
      const isRetryableError = valuationResp.status >= 500 || valuationResp.status === 429 || valuationResp.status === 520;
      
      console.log(`❌ HTTP ${valuationResp.status} for parcel ${parcelId}`);
      
      // Update error tracking for rate limiting
      handleHttpError(valuationResp.status, parcelId);
      
      if (isRetryableError && retryCount < MAX_RETRIES) {
        // Calculate exponential backoff delay with jitter
        const retryDelay = BASE_DELAY * Math.pow(2, retryCount) + (Math.random() * 1000);
        
        // Add extra delay for HTTP 520 errors
        const extraDelay = valuationResp.status === 520 ? 10000 : 0;
        const totalDelay = retryDelay + extraDelay;
        
        console.log(`🔄 HTTP ${valuationResp.status} for parcel ${parcelId}, retrying in ${Math.round(totalDelay)}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, totalDelay));
        
        // Recursive retry with incremented count
        return await scrapeParcelOwner(parcelId, env, requestIndex, retryCount + 1);
      }
      
      throw new Error(`HTTP ${valuationResp.status}: Failed to fetch parcel data`);
    }

    const html = await valuationResp.text();
    const latency = Date.now() - start;
    recordLatency(latency, true);
    
    // Extract owner information from HTML
    const ownerData = extractOwnerInfo(html);
    
    // If no owner data found, return null values instead of throwing error
    // This handles parcels that don't exist in the system gracefully
    if (!ownerData.owner) {
      console.log(`⚠️  NULL OWNER for parcel ${parcelId} - Status: not_found`);
      console.log(`Response status: ${response.status}, URL: ${targetUrl}`);
      return {
        owner: null,
        address: null,
        total_acreage: null,
        property_type: null,
        market_value: null,
        market_value_year: null,
        status: 'not_found'
      };
    }

    console.log(`✅ SUCCESS for parcel ${parcelId} - Owner: ${ownerData.owner}`);
    workerState.metrics.successfulParcels++;
  // Track parcel completion rate window
  const nowTs = Date.now();
  workerState.metrics.parcelRateWindow.push(nowTs);
  const parcelCut = nowTs - 60000;
  while (workerState.metrics.parcelRateWindow.length && workerState.metrics.parcelRateWindow[0] < parcelCut) workerState.metrics.parcelRateWindow.shift();
  // best-effort async metrics push (don't await to not slow path)
  sendRuntimeMetrics(env);
    return ownerData;
    
  } catch (error) {
    recordLatency(Date.now() - start, false, error);
    workerState.metrics.failedParcels++;
  // Still record attempt as completion timing for pacing visibility? Only on success; skip here
  sendRuntimeMetrics(env);
    // If this is a network/fetch error and we haven't exceeded max retries
    if (retryCount < MAX_RETRIES && (error.name === 'TypeError' || error.message.includes('fetch'))) {
      const retryDelay = BASE_DELAY * Math.pow(2, retryCount) + (Math.random() * 1000);
      
      console.log(`🔄 Network error for parcel ${parcelId}, retrying in ${Math.round(retryDelay)}ms (attempt ${retryCount + 1}/${MAX_RETRIES}): ${error.message}`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      
      // Recursive retry with incremented count
      return await scrapeParcelOwner(parcelId, env, requestIndex, retryCount + 1);
    }
    
    // If we've exhausted retries or it's not a retryable error, throw
    throw error;
  }
}

function buildValuationUrl(parcelId) {
  return `https://apps.saltlakecounty.gov/assessor/new/valuationInfoExpanded.cfm?parcel_id=${parcelId}`;
}

/**
 * Send runtime adaptive metrics snapshot to collector server (best-effort, non-blocking failure)
 */
async function sendRuntimeMetrics(env) {
  try {
    const m = workerState.metrics;
    const bucket = workerState.tokenBucket;
    const now = Date.now();
  // Throttle to at most once every 2 seconds (faster feedback loop)
  if (workerState.lastRuntimePost && (now - workerState.lastRuntimePost) < 2000) return;
    workerState.lastRuntimePost = now;
    // Prune windows again defensively
    const cut = now - 60000;
    while (m.requestRateWindow.length && m.requestRateWindow[0] < cut) m.requestRateWindow.shift();
    while (m.parcelRateWindow.length && m.parcelRateWindow[0] < cut) m.parcelRateWindow.shift();
    const scalingFactor = bucket.refillRatePerSec / bucket.capacity; // simple indicative ratio
    // Token-based theoretical (legacy)
    const effectiveConcurrency = Math.max(m.currentConcurrency || 1, m.internalParallelism || 1);
    const tokenTheoreticalParcelsPerMin = Math.round(bucket.refillRatePerSec * 60); // token bucket permits
    // Latency-based theoretical: effectiveConcurrency * (60s / EMA latency)
    let latencyTheoreticalParcelsPerMin = null;
    if (m.emaLatency && m.emaLatency > 0 && effectiveConcurrency > 0) {
      latencyTheoreticalParcelsPerMin = Math.round(effectiveConcurrency * (60000 / m.emaLatency));
    }
    // Effective theoretical is the lower of the two (actual bottleneck)
    let effectiveTheoreticalParcelsPerMin = tokenTheoreticalParcelsPerMin;
    if (latencyTheoreticalParcelsPerMin != null) {
      effectiveTheoreticalParcelsPerMin = Math.min(tokenTheoreticalParcelsPerMin, latencyTheoreticalParcelsPerMin);
    }
    const body = {
      worker_id: env.WORKER_ID || 'unknown',
      tokens: Math.round(bucket.tokens),
      capacity: bucket.capacity,
      refillRatePerSec: bucket.refillRatePerSec,
      currentConcurrency: m.currentConcurrency,
      emaLatencyMs: m.emaLatency ? Math.round(m.emaLatency) : null,
      requestsPerMin: m.requestRateWindow.length,
      parcelsPerMin: m.parcelRateWindow.length,
      scalingFactor,
      microDelay: m.microDelay,
      tokenTheoreticalParcelsPerMin,
      latencyTheoreticalParcelsPerMin,
      theoreticalParcelsPerMin: effectiveTheoreticalParcelsPerMin,
      dynamicBatchSize: workerState.dynamicBatchSize,
      inFlightRequests: workerState.inFlightRequests,
      lastBatchDurationMs: workerState.lastBatchDurationMs,
      localQueueLength: workerState.localParcelQueue.length,
  avgAllocationDelayMs: workerState.avgAllocationDelayMs,
  prefetchAttempts: workerState.prefetchAttempts,
  prefetchFetched: workerState.prefetchFetched,
  version: 'v4',
  internalParallelism: m.internalParallelism || null,
  pipelineOverlaps: m.pipelineOverlaps || 0,
  lastBatchOverlapMs: m.lastBatchOverlapMs || null,
  avgBatchOverlapMs: m.avgBatchOverlapMs || null,
      timestamp: new Date().toISOString()
    };
    const base = resolveCollectorBase(env);
    const token = env.COLLECTOR_TOKEN || 'your-secure-token-here';
    
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
    
    // Add Cloudflare Access headers if configured
    if (env.CF_ACCESS_CLIENT_ID) {
      headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
    }
    if (env.CF_ACCESS_CLIENT_SECRET) {
      headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET;
    }
    
    await fetch(`${base}/runtime`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }).catch(()=>{});
  } catch (e) {
    // swallow
  }
}

/**
 * Record latency and update EMA & sliding windows
 */
function recordLatency(latencyMs, ok, err) {
  const m = workerState.metrics;
  // EMA update (alpha = 0.15)
  if (m.emaLatency == null) m.emaLatency = latencyMs;
  else m.emaLatency = m.emaLatency * 0.85 + latencyMs * 0.15;
  // Keep last 100 latency samples
  m.latencySamples.push(latencyMs);
  if (m.latencySamples.length > 100) m.latencySamples.shift();
  // Status window (keep 300 seconds worth with coarse granularity ~1s)
  const now = Date.now();
  m.statusWindow.push({ t: now, ok, code: ok ? 200 : (err?.status || null) });
  // Prune >5 min
  const cutoff = now - 5 * 60 * 1000;
  while (m.statusWindow.length && m.statusWindow[0].t < cutoff) m.statusWindow.shift();
  // Track 520s
  if (err && err.message?.includes('520')) {
    m.recent520s.push(now);
    // prune 90s window for 520 tracking
    const pCut = now - 90 * 1000;
    m.recent520s = m.recent520s.filter(ts => ts >= pCut);
  }
}

/**
 * Generate unique request fingerprint for maximum independence
 * Each worker and request gets completely unique browser characteristics
 */
function generateRequestFingerprint(workerId, requestIndex = 0) {
  // Create unique seed based on worker ID and request index
  const seed = `${workerId}-${requestIndex}-${Date.now()}`;
  const hash = simpleHash(seed);
  
  // Select browser type based on hash
  const browsers = [
    'chrome', 'firefox', 'safari', 'edge', 'opera'
  ];
  const browser = browsers[hash % browsers.length];
  
  // Generate browser-specific fingerprints
  const fingerprints = {
    chrome: generateChromeFingerprint(hash),
    firefox: generateFirefoxFingerprint(hash),
    safari: generateSafariFingerprint(hash),
    edge: generateEdgeFingerprint(hash),
    opera: generateOperaFingerprint(hash)
  };
  
  const baseFingerprint = fingerprints[browser];
  
  // Add unique IP simulation (for X-Forwarded-For headers)
  const ipOctet1 = 172 + (hash % 16); // 172-187 range
  const ipOctet2 = 16 + (hash % 16);  // 16-31 range
  const ipOctet3 = hash % 256;
  const ipOctet4 = 1 + (hash % 254);
  const simulatedIP = `${ipOctet1}.${ipOctet2}.${ipOctet3}.${ipOctet4}`;
  
  return {
    ...baseFingerprint,
    xForwardedFor: simulatedIP,
    xRealIp: simulatedIP,
    dnt: (hash % 2) ? '1' : '0'
  };
}

/**
 * Generate Chrome fingerprint variations
 */
function generateChromeFingerprint(hash) {
  const versions = ['119', '120', '121', '122', '123'];
  const version = versions[hash % versions.length];
  const platforms = ['Windows NT 10.0; Win64; x64', 'Macintosh; Intel Mac OS X 10_15_7', 'X11; Linux x86_64'];
  const platform = platforms[hash % platforms.length];
  
  return {
    userAgent: `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    acceptLanguage: ['en-US,en;q=0.9', 'en-US,en;q=0.8,es;q=0.7', 'en-GB,en;q=0.9'][hash % 3],
    acceptEncoding: 'gzip, deflate, br',
    connection: 'keep-alive',
    cacheControl: hash % 2 ? 'max-age=0' : 'no-cache',
    secFetchDest: 'document',
    secFetchMode: 'navigate',
    secFetchSite: 'none',
    secChUa: `"Not_A Brand";v="8", "Chromium";v="${version}", "Google Chrome";v="${version}"`,
    secChUaMobile: '?0',
    secChUaPlatform: platform.includes('Windows') ? '"Windows"' : platform.includes('Mac') ? '"macOS"' : '"Linux"'
  };
}

/**
 * Generate Firefox fingerprint variations
 */
function generateFirefoxFingerprint(hash) {
  const versions = ['120', '121', '122', '123', '124'];
  const version = versions[hash % versions.length];
  const platforms = ['Windows NT 10.0; Win64; x64', 'Macintosh; Intel Mac OS X 10.15', 'X11; Linux x86_64'];
  const platform = platforms[hash % platforms.length];
  
  return {
    userAgent: `Mozilla/5.0 (${platform}; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    acceptLanguage: ['en-US,en;q=0.5', 'en-GB,en;q=0.5', 'en-CA,en;q=0.5'][hash % 3],
    acceptEncoding: 'gzip, deflate, br',
    connection: 'keep-alive',
    cacheControl: hash % 2 ? 'max-age=0' : 'no-cache',
    secFetchDest: 'document',
    secFetchMode: 'navigate',
    secFetchSite: 'none',
    secChUa: '',
    secChUaMobile: '?0',
    secChUaPlatform: ''
  };
}

/**
 * Generate Safari fingerprint variations
 */
function generateSafariFingerprint(hash) {
  const versions = ['17.2', '17.3', '17.4', '17.5'];
  const version = versions[hash % versions.length];
  const platforms = ['Macintosh; Intel Mac OS X 10_15_7', 'Macintosh; Intel Mac OS X 10_14_6'];
  const platform = platforms[hash % platforms.length];
  
  return {
    userAgent: `Mozilla/5.0 (${platform}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Safari/605.1.15`,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    acceptLanguage: ['en-US,en;q=0.9', 'en-GB,en;q=0.9'][hash % 2],
    acceptEncoding: 'gzip, deflate, br',
    connection: 'keep-alive',
    cacheControl: hash % 2 ? 'max-age=0' : 'no-cache',
    secFetchDest: 'document',
    secFetchMode: 'navigate',
    secFetchSite: 'none',
    secChUa: '',
    secChUaMobile: '?0',
    secChUaPlatform: '"macOS"'
  };
}

/**
 * Generate Edge fingerprint variations
 */
function generateEdgeFingerprint(hash) {
  const versions = ['120', '121', '122', '123'];
  const version = versions[hash % versions.length];
  
  return {
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36 Edg/${version}.0.0.0`,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptEncoding: 'gzip, deflate, br',
    connection: 'keep-alive',
    cacheControl: hash % 2 ? 'max-age=0' : 'no-cache',
    secFetchDest: 'document',
    secFetchMode: 'navigate',
    secFetchSite: 'none',
    secChUa: `"Not_A Brand";v="8", "Chromium";v="${version}", "Microsoft Edge";v="${version}"`,
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"'
  };
}

/**
 * Generate Opera fingerprint variations
 */
function generateOperaFingerprint(hash) {
  const versions = ['105', '106', '107', '108'];
  const version = versions[hash % versions.length];
  
  return {
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/${version}.0.0.0`,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptEncoding: 'gzip, deflate, br',
    connection: 'keep-alive',
    cacheControl: hash % 2 ? 'max-age=0' : 'no-cache',
    secFetchDest: 'document',
    secFetchMode: 'navigate',
    secFetchSite: 'none',
    secChUa: `"Not_A Brand";v="8", "Chromium";v="120", "Opera";v="${version}"`,
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"'
  };
}

/**
 * Simple hash function for deterministic randomization
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Extract owner information from HTML content
 */
function extractOwnerInfo(html) {
  // Re-enable page validation (now more permissive)
  const isValidParcelPage = isValidParcelDetailsPage(html);
  
  if (!isValidParcelPage) {
    console.log(`❌ Invalid page detected - returning null for all fields`);
    return {
      owner: null,
      address: null,
      total_acreage: null,
      property_type: null,
      market_value: null,
      market_value_year: null,
      page_status: 'invalid_page'
    };
  }
  
  // Based on the actual HTML structure we found:
  // <tr><td valign="top" scope="row">Owner </td><td style="text-align:right"> STATE OF UTAH DIV OF STATE LANDS & FORES </td></tr>
  
  const ownerRegex = /<tr><td[^>]*>Owner\s*<\/td><td[^>]*>\s*([^<]+?)\s*<\/td><\/tr>/i;
  const addressRegex = /<tr[^>]*><td[^>]*>Address<\/td><td[^>]*>\s*([^<]+?)\s*<\/td><\/tr>/i;
  const acreageRegex = /<tr[^>]*><td[^>]*>Total Acreage<\/td><td[^>]*>.*?>([\d.]+)<\/a><\/td><\/tr>/i;
  const propertyTypeRegex = /<tr[^>]*><td[^>]*>Property Type<\/td><td[^>]*>.*?>\s*([^<]+?)\s*<\/a><\/td><\/tr>/i;
  const marketValueRegex = /<tr[^>]*><td[^>]*>(\d{4})\s*Market Value<\/td><td[^>]*>\$\s*([\d,]+)<\/td><\/tr>/i;

  const ownerMatch = html.match(ownerRegex);
  const addressMatch = html.match(addressRegex);
  const acreageMatch = html.match(acreageRegex);
  const propertyTypeMatch = html.match(propertyTypeRegex);
  const marketValueMatch = html.match(marketValueRegex);

  // Enhanced debugging for owner parsing (level 4 verbose)
  debugLog(4, globalThis.__ENV_REF, `Owner regex match result:`, ownerMatch);
  if (html && html.includes('Owner')) {
    debugLog(4, globalThis.__ENV_REF, `Owner HTML snippet:`, html.substring(html.indexOf('Owner'), html.indexOf('Owner') + 200));
  }

  // Determine the owner value based on parsing results
  let ownerValue;
  if (ownerMatch) {
    const parsedOwner = ownerMatch[1].trim();
    // Check if the owner field is empty or contains placeholder text
    if (!parsedOwner || parsedOwner === '' || parsedOwner === '&nbsp;' || parsedOwner === '-') {
      ownerValue = 'No Owner Found';
    } else {
      ownerValue = parsedOwner;
    }
  } else {
    // On a valid parcel page but no owner field found
    ownerValue = 'No Owner Found';
  }

  const result = {
    owner: ownerValue,
    address: addressMatch ? addressMatch[1].trim() : null,
    total_acreage: acreageMatch ? acreageMatch[1].trim() : null,
    property_type: propertyTypeMatch ? propertyTypeMatch[1].trim() : null,
    market_value: marketValueMatch ? marketValueMatch[2].replace(/,/g, '') : null,
    market_value_year: marketValueMatch ? marketValueMatch[1] : null,
    page_status: 'valid_page'
  };

  // Log when owner is "No Owner Found" vs successful parsing
  if (ownerValue === 'No Owner Found') {
    debugLog(3, globalThis.__ENV_REF, `Valid parcel page but no owner data found`);
  } else {
    debugLog(3, globalThis.__ENV_REF, `Successfully parsed owner: ${ownerValue}`);
  }

  return result;
}

/**
 * Check if the HTML represents a valid parcel details page
 */
function isValidParcelDetailsPage(html) {
  // Very minimal validation - just check we're not on an obvious error page
  const htmlLower = html.toLowerCase();
  
  // Only reject if we have clear error indicators
  const hasObviousError = htmlLower.includes('no records found') || 
                         htmlLower.includes('server error') || 
                         htmlLower.includes('bad gateway') ||
                         htmlLower.includes('service unavailable');
  
  if (hasObviousError) {
    debugLog(2, globalThis.__ENV_REF, `Page contains obvious error - rejecting`);
    return false;
  }
  
  // Otherwise, assume it's valid and let the parsing determine success
  debugLog(4, globalThis.__ENV_REF, `Page validation passed - proceeding with parsing`);
  return true;
}

/**
 * Send scraped data to local collection server
 */
async function sendToLocalServer(env, parcelId, ownerData) {
  const base = resolveCollectorBase(env);
  
  // Debug: Log the parcel ID being sent
  debugLog(4, env, `sendToLocalServer parcelId=`, parcelId, `type=`, typeof parcelId);
  
  try {
    // Create payload with correct field mapping for database
    const payload = {
      parcel_id: parcelId,
      owner: ownerData?.owner || null,  // Server expects 'owner' field, maps to owner_name
      address: ownerData?.address || null,
      total_acreage: ownerData?.total_acreage || null,
      property_type: ownerData?.property_type || null,
      market_value: ownerData?.market_value || null,
      market_value_year: ownerData?.market_value_year || null,
      worker_id: env.WORKER_ID,
      scraped_at: new Date().toISOString()
    };
    
    // Debug: Log the full payload
  debugLog(4, env, `Sending payload:`, JSON.stringify(payload, null, 2));
    
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.COLLECTOR_TOKEN || 'default-token'}`
    };
    
    // Add Cloudflare Access headers if configured
    if (env.CF_ACCESS_CLIENT_ID) {
      headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
    }
    if (env.CF_ACCESS_CLIENT_SECRET) {
      headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET;
    }
    
    const response = await fetch(`${base}/collect`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Local server error: ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to send to local server:', error);
    // Don't throw - we want to continue processing even if storage fails
  }
}

/**
 * Send aggregated payloads to local collection server in a single batch request
 */
async function sendBatchToLocalServer(env, payloads) {
  const base = resolveCollectorBase(env);
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.COLLECTOR_TOKEN || 'default-token'}`
    };
    
    // Add Cloudflare Access headers if configured
    if (env.CF_ACCESS_CLIENT_ID) {
      headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
    }
    if (env.CF_ACCESS_CLIENT_SECRET) {
      headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET;
    }
    
    const response = await fetch(`${base}/collect-batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ records: payloads, count: payloads.length, worker_id: env.WORKER_ID, sent_at: new Date().toISOString() })
    });
    if (!response.ok) {
      throw new Error(`Local batch server error: ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to send batch to local server:', error);
    throw error; // Let caller decide fallback
  }
}

/**
 * Sleep utility function with randomization
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Resolve collector base URL with backward compatibility:
 * - Prefer COLLECTOR_BASE (should be origin only, e.g. https://tunnel.example)
 * - Fallback to LOCAL_COLLECTOR_URL (strip trailing /collect if user passed full path)
 * - Final fallback: http://localhost:3000
 */
function resolveCollectorBase(env) {
  let base = env.COLLECTOR_BASE;
  if (!base && env.LOCAL_COLLECTOR_URL) {
    // If it ends with /collect (older style) strip the path
    try {
      const u = new URL(env.LOCAL_COLLECTOR_URL);
      if (u.pathname.endsWith('/collect')) {
        u.pathname = u.pathname.replace(/\/collect$/, '');
        base = u.origin + (u.pathname === '/' ? '' : u.pathname);
      } else {
        base = u.origin + (u.pathname === '/' ? '' : u.pathname);
      }
    } catch (_) {
      base = env.LOCAL_COLLECTOR_URL; // Use as-is if parse fails
    }
  }
  if (!base) base = 'http://localhost:3000';
  // Remove trailing slash for consistency
  if (base.endsWith('/')) base = base.slice(0, -1);
  return base;
}

/**
 * Adaptive control loop (runs every 5s) - Phase 1: only token refill up/down prototypes
 */
function startControlLoop() {
  const INTERVAL = 2500; // even faster feedback loop
  setInterval(() => {
    try {
      const now = Date.now();
      const m = workerState.metrics;
      const bucket = workerState.tokenBucket;

      // Compute short window error rate (last 60s)
      const shortCut = now - 60 * 1000;
      const recent = m.statusWindow.filter(r => r.t >= shortCut);
      const errors = recent.filter(r => !r.ok).length;
      const errorRate = recent.length ? (errors / recent.length) : 0;

      // Basic conditions (Phase 1 limited logic)
      const no520Recently = m.recent520s.every(ts => now - ts > 30000);
      const ema = m.emaLatency || 0;

  let action = 'hold';
  let oldRate = bucket.refillRatePerSec;

  // Smarter ramp heuristic parameters
  const TARGET_LATENCY_MS = 900;          // Desired steady-state EMA
  const FAST_RAMP_THRESHOLD = 220;        // Below this rate we can be very aggressive
  const UTIL_BOOST_THRESHOLD = 0.82;      // If util stays below while healthy, push harder
  const HEALTHY_ERROR_RATE = 0.045;       // Acceptable error band for acceleration
  const HEALTHY_LATENCY = 1100;           // Still OK to accelerate if below this

      // Safe mode trigger conditions
      const recent520s = m.recent520s.filter(ts => now - ts <= 60 * 1000).length;
      const highError = errorRate > 0.15; // raise threshold to avoid early clamp
      if (!m.safeModeUntil && (highError || recent520s >= 2)) {
        m.safeModeUntil = now + 45 * 1000; // shorter safe mode window
        bucket.refillRatePerSec = Math.min(bucket.refillRatePerSec, 70);
        bucket.capacity = Math.round(bucket.refillRatePerSec * 2.5);
        m.currentConcurrency = 1;
        m.microDelay = Math.max(m.microDelay, 500);
        m.adjustmentHistory.push({ ts: now, action: 'enter_safe_mode', reason: highError ? 'high_error' : '520_cluster' });
        console.log(`🛑 Entering SAFE MODE (errorRate=${(errorRate*100).toFixed(2)}% recent520s=${recent520s})`);
      }
      // Exit safe mode conditions
      if (m.safeModeUntil && now > m.safeModeUntil) {
        const okToExit = errorRate < 0.04 && recent520s === 0;
        if (okToExit) {
          m.safeModeUntil = 0;
          bucket.refillRatePerSec = Math.max(bucket.refillRatePerSec, 120);
          bucket.capacity = bucket.refillRatePerSec * 3;
          m.currentConcurrency = Math.max(3, m.currentConcurrency);
          m.adjustmentHistory.push({ ts: now, action: 'exit_safe_mode' });
          console.log('✅ Exiting SAFE MODE');
        } else {
          // Extend safe mode slightly if conditions not yet good
            m.safeModeUntil = now + 20 * 1000;
        }
      }

      // Skip normal adjustments while in safe mode
      if (m.safeModeUntil) {
        return; // capacity already set
      }

      if (recent.length > 15 && errorRate < HEALTHY_ERROR_RATE && ema > 0 && ema < HEALTHY_LATENCY && no520Recently) {
        // Compute dynamic factor influenced by how far we are from target latency.
        // If latency far below target, we can ramp quicker; as we approach target, soften.
        const latencyHeadroom = Math.max(0, TARGET_LATENCY_MS - ema); // ms we can still spend
        const headroomRatio = Math.min(1, latencyHeadroom / TARGET_LATENCY_MS); // 0..1
        let baseFactor;
        if (bucket.refillRatePerSec < FAST_RAMP_THRESHOLD) baseFactor = 1.8; // very fast early ramp
        else if (bucket.refillRatePerSec < 400) baseFactor = 1.45;
        else baseFactor = 1.22;
        // Adjust factor by latency headroom (more headroom => bigger factor)
        const factor = baseFactor + (0.25 * headroomRatio);
        let newRate = Math.round(bucket.refillRatePerSec * factor + 8);
        // Utilization boost: if we're under-utilizing capacity, allow extra push
        const tpWindow = workerState.recentParcelCompletions.filter(t => t >= now - 60000).length;
        const theoreticalMax = bucket.refillRatePerSec * Math.max(1, m.currentConcurrency);
        const utilForBoost = theoreticalMax ? (tpWindow / theoreticalMax) : 0;
        if (utilForBoost < UTIL_BOOST_THRESHOLD) {
          newRate = Math.round(newRate * 1.1 + 5); // modest boost
        }
        newRate = Math.min(2500, newRate); // raise global ceiling cautiously
        // Cap single jump size to avoid runaway (<= +90%)
        if (newRate <= bucket.refillRatePerSec * 1.9) {
          bucket.refillRatePerSec = newRate;
          action = 'increase';
        }
      } else {
        // Idle / underutilization boost: if tokens are consistently at (or near) capacity, throughput low, and no errors, push harder
        const tokensNearFull = bucket.tokens > bucket.capacity * 0.92;
        const lowThroughput = (m.parcelRateWindow && m.parcelRateWindow.length < 5) && (m.requestRateWindow && m.requestRateWindow.length < 8);
        if (tokensNearFull && lowThroughput && errorRate < 0.03 && !m.safeModeUntil) {
          const boostRate = Math.min(2500, Math.round(bucket.refillRatePerSec * 1.6 + 12));
          if (boostRate > bucket.refillRatePerSec) {
            const old = bucket.refillRatePerSec;
            bucket.refillRatePerSec = boostRate;
            action = 'idle_boost';
            console.log(`🚀 IdleBoost: refillRate ${old} -> ${bucket.refillRatePerSec} (tokens full, low activity)`);
          }
        }
        // Rescue ramp: if latency high but volume extremely low, try nudging concurrency to probe (avoid being stuck)
        if (action === 'hold' && lowThroughput && m.currentConcurrency < 10 && !m.safeModeUntil && errorRate < 0.05) {
          const step = (m.currentConcurrency < 4) ? 2 : 1;
            m.currentConcurrency = Math.min(10, m.currentConcurrency + step);
          m.adjustmentHistory.push({ ts: now, action: 'rescue_ramp_conc', to: m.currentConcurrency, step });
          console.log(`🛠️  RescueRamp: increasing concurrency by ${step} -> ${m.currentConcurrency} (low throughput)`);
        }
      }
      if (action === 'hold' && ((errorRate > 0.08) || (ema > 1600) || !no520Recently)) {
        const severe = (errorRate > 0.12) || (ema > 1800);
        const mult = severe ? 0.4 : 0.65;
        bucket.refillRatePerSec = Math.max(5, Math.round(bucket.refillRatePerSec * mult));
        action = 'decrease';
      }

      // Latency saturation escalation: if latency is high but errors are low, we're latency-bound not error-bound.
      // Increase concurrency to raise pipeline depth rather than throttling.
      if (action === 'hold' && ema >= 1800 && errorRate < 0.05 && !m.safeModeUntil) {
        const veryHigh = ema > 3200;
        const lowThroughputNow = (m.parcelRateWindow?.length || 0) < 10; // last 60s
  const maxConc = 20; // expanded ceiling for new latency-bound phase
        if (m.currentConcurrency < maxConc) {
          // Step by 2 when utilization low to accelerate probing
          const utilForLatRamp = utilization;
          const step = (veryHigh || utilForLatRamp < 0.5) ? 2 : 1;
          const newConc = Math.min(maxConc, m.currentConcurrency + step);
          if (newConc !== m.currentConcurrency) {
            m.currentConcurrency = newConc;
            m.adjustmentHistory.push({ ts: now, action: 'inc_conc_latency', ema: Math.round(ema), to: m.currentConcurrency, step });
            m.lastAction = 'inc_conc_latency';
            console.log(`⏱️  LatencyEscalate: ema=${Math.round(ema)}ms conc -> ${m.currentConcurrency} (step=${step} util=${(utilForLatRamp*100).toFixed(1)}%)`);
          }
        }
        if (m.microDelay > 20 && bucket.tokens > bucket.capacity * 0.5) {
          const old = m.microDelay;
          m.microDelay = Math.max(12, Math.round(m.microDelay * 0.7));
          m.adjustmentHistory.push({ ts: now, action: 'shrink_microDelay_latency', from: old, to: m.microDelay });
        }
      }

      // Throughput plateau detection (approx parcels/min vs theoretical)
      // We estimate parcels/min as recentParcelCompletions length (already maintained elsewhere)
      const tpWindow = workerState.recentParcelCompletions.filter(t => t >= now - 60000).length;
      const theoreticalMax = bucket.refillRatePerSec * Math.max(1, m.currentConcurrency);
      const utilization = theoreticalMax ? (tpWindow / theoreticalMax) : 0;

      // New concurrency ramp rule: if healthy for 2 consecutive cycles (util>0.4, ema<5000, errorRate<0.06) and below cap 8
      if (!m._healthyCycleCount) m._healthyCycleCount = 0;
      const healthyCycle = (utilization > 0.4 && ema > 0 && ema < 5000 && errorRate < 0.06 && !m.safeModeUntil);
      if (healthyCycle) {
        m._healthyCycleCount++;
      } else {
        m._healthyCycleCount = 0;
      }
      if (m._healthyCycleCount >= 2 && m.currentConcurrency < 8) {
        const old = m.currentConcurrency;
        m.currentConcurrency += 1;
        m._healthyCycleCount = 0; // reset after ramp
        m.adjustmentHistory.push({ ts: now, action: 'healthy_ramp_conc', from: old, to: m.currentConcurrency });
        console.log(`🌱 HealthyRamp: concurrency ${old} -> ${m.currentConcurrency} (util=${(utilization*100).toFixed(1)}% ema=${Math.round(ema)} err=${(errorRate*100).toFixed(2)}%)`);
      }

      // Dynamic batch size adaptation (simple heuristic):
      // Increase batch size when latency moderate (<3500ms) and utilization < 0.6 and low errors.
      // Decrease when latency high (>6000ms) or errorRate rising.
      if (!workerState.dynamicBatchSize) workerState.dynamicBatchSize = 4;
      const oldBatch = workerState.dynamicBatchSize;
      // Extended growth rule: allow growth up to 32 if queue depth supports it (queue >= 2x batch) and utilization < 0.7 and latency stable
      const queueDepth = workerState.localParcelQueue.length;
      const stableLatency = (ema > 0 && ema < 4000);
      const canGrow = stableLatency && errorRate < 0.05 && utilization < 0.7 && workerState.dynamicBatchSize < 32 && queueDepth >= workerState.dynamicBatchSize * 2;
      if (canGrow) {
        workerState.dynamicBatchSize += (workerState.dynamicBatchSize < 16 ? 2 : 4); // faster expansion after 16
      } else if ((ema > 6500 || errorRate > 0.09) && workerState.dynamicBatchSize > 4) {
        workerState.dynamicBatchSize = Math.max(4, Math.floor(workerState.dynamicBatchSize / 2));
      }
      if (oldBatch !== workerState.dynamicBatchSize) {
        m.adjustmentHistory.push({ ts: now, action: 'adj_batch', from: oldBatch, to: workerState.dynamicBatchSize, queueDepth, utilization: +utilization.toFixed(3) });
        console.log(`📦 DynamicBatch: ${oldBatch} -> ${workerState.dynamicBatchSize} (ema=${Math.round(ema)} util=${(utilization*100).toFixed(1)}% queue=${queueDepth})`);
      }
      if (bucket.refillRatePerSec > 160 && utilization < 0.8 && errorRate < 0.05 && ema < 900 && m.currentConcurrency < 40) {
        m.currentConcurrency += 1;
        m.adjustmentHistory.push({ ts: now, action: 'inc_conc_plateau', to: m.currentConcurrency, util: +utilization.toFixed(2) });
      }

      // Aggressive low-utilization ramp: if utilization extremely low and errors minimal, jump concurrency faster
      if (utilization < 0.5 && errorRate < 0.04 && bucket.refillRatePerSec > 120 && m.currentConcurrency < 50) {
        const oldConc = m.currentConcurrency;
        const jump = m.currentConcurrency < 10 ? 3 : (m.currentConcurrency < 20 ? 2 : 1);
        m.currentConcurrency = Math.min(50, m.currentConcurrency + jump);
        if (m.currentConcurrency !== oldConc) {
          m.adjustmentHistory.push({ ts: now, action: 'inc_conc_low_util', from: oldConc, to: m.currentConcurrency, util: +utilization.toFixed(2) });
          console.log(`📈 LowUtilRamp: conc ${oldConc} -> ${m.currentConcurrency} (util=${(utilization*100).toFixed(1)}%)`);
        }
      }

      // Concurrency tuning on negative signals
      if (action === 'decrease' && (errorRate > 0.08 || ema > 1600) && m.currentConcurrency > 1) {
        m.currentConcurrency = Math.max(1, Math.ceil(m.currentConcurrency / 2));
        m.microDelay = Math.max(m.microDelay, 150);
        m.adjustmentHistory.push({ ts: now, action: 'dec_concurrency', to: m.currentConcurrency });
      }

      // Success-based microDelay decay
      if (action === 'increase' && m.microDelay > 12 && errorRate < 0.025) {
        const old = m.microDelay;
        m.microDelay = Math.max(12, Math.round(m.microDelay * 0.90));
        if (old !== m.microDelay) m.adjustmentHistory.push({ ts: now, action: 'dec_microDelay', from: old, to: m.microDelay });
      }

      // Capacity follows rate (3s burst)
      bucket.capacity = Math.round(bucket.refillRatePerSec * 3.2); // slightly larger burst buffer
      bucket.tokens = Math.min(bucket.tokens, bucket.capacity);

      if (action !== 'hold') {
        m.lastAction = action;
        m.adjustmentHistory.push({ ts: now, action, from: oldRate, to: bucket.refillRatePerSec, ema, errorRate: +errorRate.toFixed(4), util: +utilization.toFixed(2), conc: m.currentConcurrency });
        if (m.adjustmentHistory.length > 10) m.adjustmentHistory.shift();
        console.log(`⚙️ ControlLoop: ${action} refillRate ${oldRate} -> ${bucket.refillRatePerSec} (conc=${m.currentConcurrency} ema=${Math.round(ema)}ms err=${(errorRate*100).toFixed(2)}%)`);
      }
    } catch (e) {
      console.error('Control loop error:', e);
    }
  }, INTERVAL);
}