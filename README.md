# Distributed Property Data Collection Platform

Portfolio project demonstrating a distributed scraping and ingestion system built with Cloudflare Workers, Node.js, SQLite, and a React observability dashboard.

The system collects public Salt Lake County property owner records at scale while coordinating work across multiple edge workers, protecting the upstream site with adaptive throttling, and exposing runtime metrics for operational tuning.

## Project Goals

This project was built to show practical system design skills beyond a basic scraper:

- Coordinate parallel work across independently deployed Cloudflare Workers.
- Persist scraped records into a local SQLite data store with resumable progress.
- Adapt throughput dynamically based on latency, error rate, and HTTP 520 patterns.
- Surface operational metrics through API endpoints, CLI monitors, and a web dashboard.
- Make runtime behavior tunable without redeploying workers.

## System Design

### Architecture

```text
Cloudflare Workers
  - scrape parcel owner records
  - maintain local token bucket state
  - prefetch work from collector
  - post results and runtime metrics

Express Data Collector
  - authenticates worker requests
  - allocates parcel IDs
  - stores owner records in SQLite
  - exposes stats, worker state, config, and allocation APIs

SQLite Database
  - source parcel table
  - scraped owner data
  - progress and worker-derived reporting queries

React Dashboard
  - polls collector APIs
  - visualizes progress, worker health, throughput, and utilization
  - updates selected runtime config values
```

### Data Flow

1. The collector reads unprocessed parcel IDs from `salt_lake_county_lir_parcels`.
2. Workers request allocations through `/reallocate/:workerId/:count` or `/global-allocate/:workerId/:count`.
3. Each worker scrapes parcel detail pages and extracts owner, address, acreage, property type, and market value fields.
4. Workers send records to `/collect` or `/collect-batch` using bearer-token authentication.
5. The collector writes records into `owner_data` with `INSERT OR REPLACE`, allowing interrupted runs to resume.
6. Workers post runtime snapshots to `/runtime`; the dashboard consumes `/stats`, `/workers-extended`, `/runtime`, and `/config`.

### Work Allocation

The collector keeps a global in-memory pool of unprocessed parcel IDs backed by SQLite queries. It filters out records already stored in `owner_data`, avoids currently allocated parcels, and periodically refills the pool.

Workers also maintain a local queue. They prefetch work in batches to reduce idle time caused by network latency or collector allocation delays. This creates a two-level buffering model:

- Collector-level pool for fair global distribution.
- Worker-level queue for low-latency autonomous scraping.

### Adaptive Throughput Control

The independent worker implementation in `src/worker-independent.js` includes a feedback loop designed to balance speed and upstream stability.

Core controls:

- Token bucket rate limiter with dynamic refill rate and burst capacity.
- Adaptive concurrency for internal batch fan-out.
- Per-request micro delay that rises during unstable periods.
- Exponential moving average latency tracking.
- Sliding error windows and HTTP 520 detection.
- Safe mode that temporarily reduces throughput after error spikes.
- Runtime config polling for selected tuning values.

The goal is not simply maximum request rate. The worker tracks utilization against theoretical throughput and adjusts when latency and error conditions indicate unused capacity or saturation risk.

### Fault Tolerance

The system is designed for long-running, interruptible jobs:

- Duplicate-safe writes use `INSERT OR REPLACE`.
- Progress is derived from database state, not only process memory.
- Workers can be restarted and resume from remaining parcel IDs.
- Failed or blank owner records can be reselected for retry.
- Runtime metrics are best-effort, so scraping can continue if telemetry posts fail.
- Collector endpoints expose allocation state for diagnosing stuck or idle workers.

### Security and Configuration

Worker-to-collector writes are protected with a bearer token configured through `COLLECTOR_TOKEN`. The collector also supports Cloudflare Access client headers through:

- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`

Important runtime variables:

| Variable | Purpose |
| --- | --- |
| `COLLECTOR_TOKEN` | Shared bearer token for worker writes and config updates |
| `COLLECTOR_BASE` | Collector origin used by workers, for example an HTTPS tunnel URL |
| `WORKER_ID` | Unique worker identifier for allocation and metrics |
| `DEBUG_LEVEL` | Worker logging level from `0` to `4` |
| `CONTINUOUS` | Set to `0` to disable autonomous worker loop |
| `INTERNAL_PARALLEL` | Runtime-tunable per-batch fan-out width |
| `PIPELINE_TRIGGER_FRACTION` | Runtime-tunable prefetch trigger point |
| `VITE_API_BASE` | Dashboard API base URL |
| `VITE_COLLECTOR_TOKEN` | Dashboard token for authenticated config updates |

## Observability

Observability is treated as a first-class part of the project rather than an afterthought.

### Collector Metrics

The Express collector exposes:

| Endpoint | Description |
| --- | --- |
| `GET /stats` | Overall progress, stored count, remaining count, and collector counters |
| `GET /workers` | Merged worker progress and latest runtime snapshots |
| `GET /workers-extended` | Worker metrics plus allocation pool metadata |
| `GET /runtime` | Latest adaptive runtime snapshot per worker |
| `GET /allocation-status` | Current global pool and allocation diagnostics |
| `GET /recent/:limit?` | Recently stored owner records |
| `GET /config` | Current runtime tuning config |
| `PUT /config` | Authenticated config update with server-side clamping |

### Worker Runtime Metrics

Workers report operational snapshots containing:

- Current token count and bucket capacity.
- Refill rate and theoretical throughput.
- Current concurrency and dynamic batch size.
- Request and parcel throughput per minute.
- EMA latency.
- Micro delay.
- Local queue length and in-flight request count.
- Pipeline overlap measurements.
- Worker version and last-seen timestamp.

### Dashboard

The dashboard in `dashboard/` is a Vite + React + Radix UI application. It visualizes:

- Total completed and remaining parcels.
- Aggregate actual versus theoretical parcels per minute.
- Utilization percentage.
- Worker-level token bucket state.
- Worker concurrency, latency, queue length, and last-seen status.
- Allocation pool health.
- Runtime config controls.
- Debug and diagnostic panels.

### CLI Monitoring

For terminal-only operation, the repo also includes CLI monitors:

```bash
npm run monitor
npm run monitor:independent
```

## Technical Skillset Demonstrated

### Distributed Systems

- Parallel edge worker orchestration.
- Work partitioning and reallocation.
- Backpressure and adaptive rate control.
- Resumable long-running jobs.
- Idempotent ingestion and retry-safe storage.

### Backend Engineering

- Node.js and Express API design.
- SQLite persistence and reporting queries.
- Authenticated ingestion endpoints.
- Operational endpoints for metrics and diagnostics.
- Process-level scheduling for pool refreshes, backups, and cleanup.

### Frontend and Observability

- React dashboard with TypeScript.
- Polling-based metrics UI.
- Worker-level health and throughput visualizations.
- Runtime configuration controls with authenticated writes.
- Radix UI components for clear operator-facing views.

### Cloud and Tooling

- Cloudflare Workers deployment with Wrangler.
- Multi-worker deployment and cleanup scripts.
- Local collector integration with remotely deployed workers.
- Environment-based configuration for development and production.

### Data Engineering

- Public-record extraction and normalization.
- SQLite-backed progress tracking.
- Batch ingestion.
- Duplicate-resistant writes.
- Export-friendly local dataset generation.

## Tech Stack

| Layer | Tools |
| --- | --- |
| Edge compute | Cloudflare Workers, Wrangler |
| Collector API | Node.js, Express |
| Storage | SQLite |
| Dashboard | React, TypeScript, Vite, Radix UI |
| Monitoring | REST metrics endpoints, CLI monitors, dashboard polling |
| Scripts | Node.js orchestration utilities |

## Repository Structure

```text
.
├── src/
│   ├── worker.js                  # Baseline worker implementation
│   ├── worker-independent.js      # Autonomous adaptive worker
│   └── perf-test-worker.js        # Performance testing worker
├── server/
│   └── data-collector.js          # Express collector, allocation, metrics, SQLite writes
├── dashboard/
│   ├── src/pages/Dashboard.tsx    # Main observability dashboard
│   ├── src/components/            # Metric cards, worker table, config/debug panels
│   └── src/util/api.ts            # Collector API client
├── scripts/
│   ├── deploy-independent.js      # Deploy independent worker set
│   ├── start-independent.js       # Start autonomous scraping run
│   ├── monitor-independent.js     # CLI monitor for independent workers
│   ├── monitor-progress.js        # General progress monitor
│   └── cleanup-old-workers.js     # Worker cleanup utility
├── work/                          # Generated parcel work files
├── wrangler.toml                  # Cloudflare Worker config
└── package.json                   # Root scripts and dependencies
```

## Running Locally

Install root dependencies:

```bash
npm install
```

Start the local collector:

```bash
COLLECTOR_TOKEN=your-token npm run start-server
```

Run the dashboard:

```bash
cd dashboard
npm install
VITE_API_BASE=http://localhost:3000 VITE_COLLECTOR_TOKEN=your-token npm run dev
```

Deploy workers after configuring Wrangler:

```bash
wrangler login
npm run deploy-independent
```

Start an independent scraping run:

```bash
npm run scrape:independent
```

Monitor progress:

```bash
npm run monitor:independent
```

## Available Scripts

| Script | Description |
| --- | --- |
| `npm run deploy` | Deploy baseline worker |
| `npm run deploy-workers` | Deploy generated concurrent workers |
| `npm run deploy-independent` | Deploy autonomous independent workers |
| `npm run start-server` | Start the local Express collector |
| `npm run populate-work` | Generate work distribution files |
| `npm run start-scraping` | Start baseline scraping orchestration |
| `npm run scrape:independent` | Start independent worker orchestration |
| `npm run monitor` | Run general CLI progress monitor |
| `npm run monitor:independent` | Run independent worker monitor |
| `npm run dashboard` | Start the Vite dashboard |
| `npm run tail` | Stream worker logs with Wrangler |

## API Summary

### Worker Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /scrape?parcel_id=...` | Scrape one parcel |
| `POST /batch` | Scrape a batch of parcel IDs |
| `GET /status` | Return adaptive worker status |
| `GET /reallocate` | Request additional work from collector |

### Collector Endpoints

| Endpoint | Description |
| --- | --- |
| `POST /collect` | Store one record or a record array |
| `POST /collect-batch` | Store a batch payload |
| `POST /runtime` | Store latest worker runtime metrics |
| `GET /stats` | Read aggregate progress |
| `GET /workers-extended` | Read worker and allocation diagnostics |
| `GET /config` | Read runtime config |
| `PUT /config` | Update runtime config |

## Ethical Scope

This project targets public assessor data and includes throttling, error backoff, and safe-mode behavior to avoid overwhelming the upstream service. It is intended as a portfolio and systems engineering demonstration, not as a bypass mechanism for private, restricted, or access-controlled data.
