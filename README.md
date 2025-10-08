# Salt Lake County Property Owner Scraper

A distributed Cloudflare Workers system for scraping property owner information from Salt Lake County's assessor website. This system uses multiple concurrent workers to efficiently process hundreds of thousands of property records and stores the data in a local SQLite database.

## 🏗️ Architecture

- **Multiple Workers**: Deploy 5+ concurrent Cloudflare Workers for parallel processing
- **Local SQLite Storage**: Data collected and stored in your existing SQLite database
- **Local Data Collector**: Express.js server that receives data from workers
- **Rate Limiting**: Built-in delays and respectful scraping practices
- **Monitoring**: Real-time progress tracking and performance metrics
- **Fault Tolerance**: Automatic retries and error handling

## 📋 Features

- ✅ Scrapes owner names, addresses, and property details
- ✅ Concurrent processing with multiple workers
- ✅ Local SQLite database storage (extends your existing database)
- ✅ Local data collection server for reliable data handling
- ✅ Real-time progress monitoring
- ✅ Handles 391,000+ parcel records from Salt Lake County
- ✅ Respectful rate limiting to avoid overwhelming target site
- ✅ Comprehensive error handling and retry logic

## 🚀 Quick Start

### 1. Prerequisites

```bash
# Install dependencies
npm install

# Install wrangler CLI globally
npm install -g wrangler

# Login to Cloudflare
wrangler login
```

### 2. Setup Dependencies

```bash
# Install Node.js dependencies
npm install

# This will install:
# - express (for local data collector server)
# - sqlite3 (for database operations)
# - wrangler (Cloudflare Workers CLI)
```

### 3. Deploy Workers

```bash
# Deploy all concurrent workers
npm run deploy-workers
```

### 4. Start Data Collector

```bash
# Start the local data collection server
npm run start-server

# Server will run on http://localhost:3000
# This receives data from workers and stores it in SQLite
```

### 5. Create Work Distribution

```bash
# Create work files for each worker from your SQLite database
npm run populate-work
```

### 6. Start Scraping

```bash
# Start all workers concurrently
npm run start-scraping

# In another terminal, monitor progress
npm run monitor
```

## 🛠️ Available Scripts

| Script | Description |
|--------|-------------|
| `npm run deploy` | Deploy single worker |
| `npm run deploy-workers` | Deploy all concurrent workers |
| `npm run start-server` | Start local data collection server |
| `npm run populate-work` | Create work distribution files |
| `npm run start-scraping` | Start all workers scraping |
| `npm run monitor` | Real-time progress monitoring |
| `npm run tail` | View worker logs |

## 📊 Monitoring

The repository previously included a CLI monitor script. A new Radix UI powered web dashboard now lives under `dashboard/` to visualize:

### Dynamic Runtime Configuration (Dashboard)

The dashboard includes a "Runtime Worker Config" panel enabling live tuning of selected parameters without redeploying workers.

| Key | Description | Range | Poll Interval |
|-----|-------------|-------|---------------|
| INTERNAL_PARALLEL | Per-batch internal fan-out width | 1–32 (guarded) | ~10s |
| PIPELINE_TRIGGER_FRACTION | Fraction of batch launched before next-batch prefetch fires | 0.05–0.95 | ~10s |

API:
* `GET /config` → `{ config: { INTERNAL_PARALLEL, PIPELINE_TRIGGER_FRACTION } }`
* `PUT /config` (Bearer auth) → partial update; clamps invalid values.

Workers poll the endpoint every ~10 seconds and log a change event when new values are applied.

Auth & Dashboard Usage:
* Updates require the same bearer `COLLECTOR_TOKEN` used by workers and server.
* Supply it to the dashboard by either:
   1. Setting an env var when launching dev: `VITE_COLLECTOR_TOKEN=yourtoken npm run dev`
   2. Pasting the token into the "Auth Token" field in the Config panel (stored in localStorage for convenience).
* A 401 "Failed to update config" means the token was missing or mismatched. Reload, verify server logs show the expected token, and re-enter.

Throughput Model Update:
* Effective theoretical now factors in the larger of adaptive concurrency and INTERNAL_PARALLEL for latency-based capacity.
* Raising INTERNAL_PARALLEL increases per-batch in-flight requests (fan-out) which can improve utilization if latency is the bottleneck.
* If token-based theoretical (refillRatePerSec * 60) is already the lower bound, increasing INTERNAL_PARALLEL alone won't raise effective throughput; increase refillRatePerSec indirectly via healthy performance to benefit.

Operational guidance:
1. Increase `INTERNAL_PARALLEL` gradually; watch EMA latency & error rate.
2. Lower `PIPELINE_TRIGGER_FRACTION` if batch idle gaps remain (low overlap).
3. Raise `PIPELINE_TRIGGER_FRACTION` if overlap is high but throughput flat (prefetch too early).

Safeguards: Server clamps values; if dashboard unreachable, workers keep last config.


### Run the Dashboard

In one terminal start the data collector server (ensure COLLECTOR_TOKEN matches your workers):

```
node server/data-collector.js
```

In another terminal run the dashboard dev server:

```
cd dashboard
npm install   # first time only
npm run dev
```

Then open the printed local URL (default http://localhost:5173). The dashboard polls `/stats` and worker stats endpoints every few seconds.

If your collector runs on a non-default port set Vite env var:

```
VITE_API_BASE=http://localhost:3000 npm run dev
```

### Runtime Adaptive Metrics (New)

Workers now periodically POST adaptive runtime snapshots to the collector so you can visualize scaling and token bucket behavior in real time.

Endpoints:

* `POST /runtime` (auth required) – Body fields:
   - `worker_id` (string)
   - `tokens` (number, current tokens in bucket)
   - `capacity` (number, token bucket capacity)
   - `refillRatePerSec` (number, token refill rate per second)
   - `currentConcurrency` (number)
   - `emaLatencyMs` (number | null)
   - `requestsPerMin` / `parcelsPerMin` (number – sliding window counts)
   - `scalingFactor` (number, derived ratio refillRatePerSec / capacity)
   - `microDelay` (current inter-request micro delay)
   - `timestamp` (ISO string)
* `GET /runtime` – Returns array of latest snapshots (one per worker)
* `GET /runtime/:workerId` – Returns snapshot for a single worker

Dashboard Worker Table Columns Added:

* Tokens – current tokens / capacity plus a color bar (green >50%, amber 20–50%, red <20%).
* Scaling – scalingFactor (refillRatePerSec / capacity) for quick comparison across workers.
* Refill/s – raw refillRatePerSec.
* Existing concurrency, req/min, parcels/min, EMA latency columns still present.

If you add more adaptive logic (dynamic capacity or refill adjustments), update `sendRuntimeMetrics` in `src/worker-independent.js` to include those fields.

### Unified Workers Endpoint

To reduce dozens of per-worker HTTP calls the collector now exposes:

* `GET /workers` – Returns merged processed counts and latest runtime snapshot for every worker seen either in stored data or runtime posts.

   "processed": 15432,
   "tokens": 180,
   "capacity": 240,
   "refillRatePerSec": 120,
   "currentConcurrency": 3,
   "emaLatencyMs": 405,
   "requestsPerMin": 7100,
   "parcelsPerMin": 980,
   "scalingFactor": 0.50,
   "theoreticalParcelsPerMin": 7200,
   "version": "v3",
   "lastSeen": "2025-09-23T22:14:12.345Z"
```


### Collector Base URL Configuration (Updated)
Set `COLLECTOR_BASE` (origin only, e.g. `https://your-tunnel.example`) for cleaner configuration.


[vars]
```

Worker code now sends:
* `POST {COLLECTOR_BASE}/collect-batch`

If neither variable is present it falls back to `http://localhost:3000` (development only).

### Utilization Card (New)

A new dashboard card aggregates all workers:

* Actual throughput: sum of `parcelsPerMin`
* Theoretical throughput: sum of `theoreticalParcelsPerMin` derived from refill rates
* Utilization % = actual / theoretical

Target steady-state utilization: 60–75%. Consistently <40% suggests increasing concurrency or adding a worker; consistently >85% risks latency spikes.

### Troubleshooting Empty Worker Table

If the dashboard Workers table shows empty/placeholder rows:

1. Ensure workers are posting runtime snapshots: look for `POST /runtime` in server logs.
2. Confirm bearer token matches `COLLECTOR_TOKEN` in worker environment.
3. Hit `http://localhost:3000/workers` directly – should return an array. If empty but `/stats` shows progress, workers may not include `worker_id` when sending data; verify payload field names (`worker_id`).
4. Check CORS / network errors in browser dev tools (fetch to `/workers`).
5. If only processed counts appear but no adaptive metrics, the runtime posts haven't started yet (throttled to every 5s and triggered on scrape success/failure).
6. For brand new workers with zero stored rows you will still see them as soon as a runtime snapshot posts.

### CLI Independent Monitor Fallback (New)
### Next Enhancements

- Historical latency & throughput sparkline
- Error rate 60s window card
- Color-coded latency thresholds
- WebSocket push (reduce polling overhead)

```bash
npm run monitor
```

Example output:
```
🏠 Salt Lake County Property Owner Scraper - Live Monitor
============================================================
Started: 12/22/2024, 2:30:00 PM
Current: 12/22/2024, 2:45:00 PM

📊 Overall Progress:
   Total Parcels:    391,099
   Completed:        12,450 (3.18%)
   Pending:          378,649
   In Progress:      45
   Failed:           12
   ID       | Status  | Processed | Failed | Last Seen
   worker-1 | active  |     2,489 |      3 | 2:45:12 PM
   worker-2 | active  |     2,501 |      1 | 2:45:08 PM
   worker-3 | active  |     2,467 |      4 | 2:45:15 PM
   worker-4 | active  |     2,498 |      2 | 2:45:10 PM
   worker-5 | active  |     2,495 |      2 | 2:45:11 PM

📈 Performance:
   Current Rate:     830 parcels/minute
   ETA:              7.6 hours
```

## 🔧 Configuration

## 🧠 Adaptive Throughput & Protection System (v3)

The worker implements an adaptive control loop to maximize safe throughput while preventing HTTP 520 and related transient errors.

Core components:

- Token Bucket Rate Limiter:
   - Dynamic refill rate (requests/sec) adjusted every 3s (faster feedback loop)
   - Capacity now scales at 3× refillRatePerSec (previously 2×) to allow short controlled bursts
   - Tokens are consumed per parcel (or per request) enabling burst smoothing
   - If utilization < 75% for multiple control intervals while not error/latency bound, concurrency increments
   - Prevents artificial ceilings when latency is healthy but refill alone no longer improves throughput
- Micro Delay (per task spacing):
   - Dynamic floor lowered (now as low as 15ms) and decays faster on sustained success
   - Increases exponentially when severe errors/520 clusters appear
- Latency Feedback (EMA):
   - Exponential moving average latency guides throttle adjustments & protects against upstream saturation
- Error Windows:
   - Short window (60s) error rate drives conservative or aggressive adjustments
- Safe Mode:
   - Triggers on: >10% short-window errors OR clustered HTTP 520s
   - Forces conservative params (low refill rate, concurrency=1, higher microDelay) for a cool-down window
   - Exits after stability (no new 520s + low error rate) for a set period
- Theoretical Throughput Estimation (NEW):
   - `theoreticalParcelsPerMin = refillRatePerSec * 60` surfaced for gap analysis vs actual `parcelsPerMin`
- Adjustment History:
   - Control loop (now every 3000ms) records each decision for auditability (exposed via /status)

Status Endpoint Additions (`GET /status`):
```
{
   "adaptive": {
      "refillRatePerSec": 138.7,
      "tokens": 310.4,
      "capacity": 416,              // 3 × refill (rounded) allowing short burst
      "currentConcurrency": 5,
      "microDelay": 22,
      "emaLatency": 405.2,
      "errorRate60s": 0.013,
      "recent520s": 0,
      "safeMode": false,
      "safeModeUntil": null,
      "theoreticalParcelsPerMin": 8322,
      "controlLoopIntervalMs": 3000,
      "adjustments": [ { "t": 1734989000000, "reason": "plateau_concurrency_increase" } ]
   }
}
```

### Heuristics Overview (v3)

- Increase refill rate when: low error rate & EMA latency below soft ceiling and utilization high
- Plateau detection: if actual `parcelsPerMin` < 75% of `theoreticalParcelsPerMin` across intervals AND low error/latency → attempt concurrency bump
- Safe mode overrides all dynamic increases

### Environment Variable: `DEBUG_LEVEL`
| 0     | Silent   | Nothing (except fatal errors via console.error)    |
| 1     | Errors   | Errors only                                        |
| 2     | Warnings | + warnings / notable degradations                  |
| 3     | Info     | + key lifecycle & adaptation events (recommended)  |
| 4     | Verbose  | + per-request debug, parsing details, payloads     |

Example (wrangler):
```
wrangler deploy --var DEBUG_LEVEL=4
```

### Safe Mode Indicators

During safe mode the status endpoint shows `safeMode: true` and the log stream emits a clear entry when entering/exiting. Throughput is intentionally reduced to recover.

### Future Enhancements (Ideas)

- Persistence of adjustment history across restarts
- Dynamic target selection via percentile latency budgeting
- Multi-worker coordination layer (global token bucket)

---

## 🔧 Configuration

### Worker Configuration (`wrangler.toml`)

```toml
name = "salt-lake-scraper"
main = "src/worker.js"
compatibility_date = "2024-09-23"

[[d1_databases]]
binding = "DB"
database_name = "salt-lake-owners"
database_id = "your-database-id-here"

[vars]
WORKER_ID = "master"
RATE_LIMIT_MS = "1000"
BATCH_SIZE = "100"
```

### Environment Variables

- `WORKER_ID`: Unique identifier for each worker
- `RATE_LIMIT_MS`: Delay between requests (milliseconds)
- `BATCH_SIZE`: Number of parcels processed per batch
- `MAX_RETRIES`: Maximum retry attempts for failed requests

## 🎯 API Endpoints

Each deployed worker exposes these endpoints:

### `GET /scrape?parcel_id={id}`
Scrape a single parcel's owner information.

### `POST /batch`
```json
{
  "parcel_ids": ["26012320040000", "15111350330000"],
  "worker_id": "worker-1",

### `GET /status`
## 📁 Project Structure

│   └── worker.js              # Main worker script
├── scripts/
│   ├── monitor-progress.js    # Real-time monitoring
│   └── start-scraping.js      # Coordinate scraping
└── README.md                  # This file
```

- **`owner_data`**: Stores scraped property owner information
- **`work_queue`**: Manages work distribution among workers
- **`worker_status`**: Tracks worker performance and health
- `owner_name`: Property owner name
- `property_address`: Property address
- `market_value`: Current market valuation
- `scrape_status`: Processing status (pending/completed/failed)

## ⚡ Performance (Adaptive v3)

The upgraded adaptive engine increases the ceiling for safe sustained throughput while preserving protective back-offs.

### v2 → v3 Change Summary

| Area | v2 | v3 |
|------|----|----|
| Control Loop Interval | 5000 ms | 3000 ms |
| Capacity Formula | 2 × refillRate | 3 × refillRate |
| Concurrency Ceiling | ~8 | Up to 16 (guarded) |
| Micro Delay Floor | ~30 ms | 15 ms |
| Plateau Logic | None | Utilization + throughput gap triggers concurrency increase |
| Throughput Metric | Actual only | Adds theoreticalParcelsPerMin |

### Practical Tuning Workflow

1. Start 1 worker; wait through warm-up (watch `emaLatency` stabilize < 500–600ms).
2. Observe gap: `theoreticalParcelsPerMin - parcelsPerMin`.
   - If gap > 35% and `errorRate60s < 0.03` and latency stable → allow concurrency to rise (it will auto-bump) or manually deploy a second worker.
3. Add workers gradually (1 → 2 → 3). After each addition, watch for:
   - Latency inflation > 40% baseline
   - Error rate creeping above 5%
   - Repeated safe mode entries
4. If safe mode triggers frequently:
   - Temporarily reduce worker count OR
   - Introduce a higher microDelay floor (code constant) & redeploy
5. Target: actual sustained ≥ 60–70% of theoretical; chasing 90–100% usually creates instability.

### Reading the Gap
High theoretical but modest actual throughput usually means one of:
* Concurrency not yet high enough (utilization < 0.75 for several loops)
* Downstream latency variance causing idle token accumulation
* Hidden bottleneck (server-side ingestion, local I/O, etc.)

### Initial Expected Ranges (Subject to Site Stability)
* Warm-up ramp: ~0.5–1.5 minutes (refill rises from ~25 rps upward)
* Single worker (optimistic): 1100–1500 parcels/min sustained
* Multi-worker: add until aggregate latency EMA drifts or safe mode appears more than once every ~10 minutes

If you cannot exceed ~200 parcels/min total:
* Confirm new code deployed (status shows `controlLoopIntervalMs: 3000`)
* Ensure theoreticalParcelsPerMin is > 1000; if not, adaptive loop still conservative (recent errors?)
* Check for recurring 520 clusters pushing system into safe mode
* Inspect server CPU / SQLite write contention (ingestion stalls can back up workers)

### Safe Expansion Checklist
| Check | Goal |
|-------|------|
| emaLatency | < 600ms sustained |
| errorRate60s | < 3% before scaling further |
| recent520s | 0 during last 2–3 loops |
| utilization | > 0.75 (actual/theoretical) |
| safeMode | false |

When all conditions green for 3+ consecutive control intervals, additional concurrency or another worker is likely safe.

---

The new adaptive engine targets high sustained throughput while protecting against HTTP 520 bursts.

Baseline (single optimized worker):
- Warm-up ramp: ~0.5–1.5 minutes (refill rate climbs 25 rps → 40+ rps)
- Expected target (validate live): 1100–1500 parcels/min (latency dependent)
- Bursting: Short bursts allowed via token bucket capacity (3 × refillRatePerSec)

Multi-worker scaling:
- Roughly linear until remote latency inflation > ~40% or error rate > 3–5%
- Recommended: Start 1 → 2 → 3 workers, re-evaluating after each addition.

Protection mechanisms automatically slow down on:
- Error rate spikes (>5–6% short window)
- HTTP 520 clusters (>=2 in 60s) → Safe Mode
- EMA latency inflation ( > 1200ms )

Tuning knobs (env vars):
- `DEBUG_LEVEL`: 0–4 (logging)
- (Future) `TARGET_REFILL_MAX` or `SAFE_MODE_REFILL` (can be added if external control desired)

Completion Time Estimates (391K parcels) – illustrative:
- 1 worker @ 1200 ppm: ~5.4 hours
- 2 workers @ 1100 ppm each: ~3.0 hours
- 3 workers @ 1000 ppm each: ~2.2 hours
- Diminishing returns likely beyond 3 without further site-specific tuning.

## 🛡️ Error Handling

- Automatic retries for failed requests
- Graceful handling of network timeouts
- Detailed error logging and tracking
- Resume capability for interrupted scraping

## 📝 Legal & Ethics

- Respectful scraping with appropriate delays
- Public data only (assessor records)
- No circumvention of robots.txt or rate limits
- Educational/research use recommended

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Test thoroughly with a small dataset first
4. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## ⚠️ Disclaimer

This tool is for educational purposes. Users are responsible for complying with terms of service and applicable laws. Always respect website rate limits and scraping policies.