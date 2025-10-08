export interface StatsResponse {
  totalStored: number;
  totalReceived: number;
  totalErrors: number;
  remainingParcels: number;
  completedParcels: number;
  totalParcels?: number;
  errorRate60s?: number;
  avgLatencyMs?: number;
  emaLatencyMs?: number;
  refillRatePerSec?: number;
  tokenBucketCapacity?: number;
  currentConcurrency?: number;
  requestsPerMin?: number;
  parcelsPerMin?: number;
}

export interface WorkerStat {
  workerId: string;
  processed: number;
  errors: number;
  avgLatencyMs?: number;
  emaLatencyMs?: number;
  lastSeen: string | number;
  version?: string;
  recentStatuses?: string[];
  recent520s?: number[];
  requestsPerMin?: number;
  parcelsPerMin?: number;
  currentConcurrency?: number;
  tokens?: number;
  capacity?: number;
  refillRatePerSec?: number;
  scalingFactor?: number;
  microDelay?: number;
  theoreticalParcelsPerMin?: number;
  utilizationPct?: number; // derived client-side
  tokenTheoreticalParcelsPerMin?: number;
  latencyTheoreticalParcelsPerMin?: number;
  effectiveTheoreticalParcelsPerMin?: number;
  dynamicBatchSize?: number;
  inFlightRequests?: number;
  lastBatchDurationMs?: number;
  localQueueLength?: number;
  internalParallelism?: number;
  pipelineOverlaps?: number;
  lastBatchOverlapMs?: number;
  avgBatchOverlapMs?: number;
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    throw new Error(`${res.status} ${res.statusText} ${text}`.trim());
  }
  return res.json();
}

const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3000';

export async function fetchStats(): Promise<StatsResponse> {
  // assuming server /stats already aggregates
  return json<StatsResponse>(`${API_BASE}/stats`);
}

export async function fetchWorkers(): Promise<WorkerStat[]> {
  // if server had an endpoint /worker-stats returning all, use it; otherwise we need a list of ids.
  // For now, try bulk endpoint then fallback to probing 1..20.
  try {
    const bulk = await json<any[]>(`${API_BASE}/worker-stats`);
    if (Array.isArray(bulk)) return bulk.map(r => ({
      workerId: r.worker_id || r.workerId,
      processed: r.processed ?? 0,
      errors: r.errors ?? 0,
      lastSeen: r.lastSeen || Date.now(),
    }));
  } catch (_) { /* ignore */ }
  const workers: WorkerStat[] = [];
  for (let i = 1; i <= 20; i++) {
    try {
      const stat = await json<any>(`${API_BASE}/worker-stats/${i}`);
      if (stat && (stat.workerId || stat.worker_id)) {
        workers.push({
          workerId: stat.workerId || stat.worker_id,
          processed: stat.processed || 0,
            errors: stat.errors || 0,
            lastSeen: Date.now(),
        });
      }
    } catch (e) { /* stop on first gap after some found */
      if (i > 5 && workers.length === 0) break;
    }
  }
  return workers;
}

// Fetch runtime adaptive metrics snapshots
export async function fetchRuntimeMetrics(): Promise<Partial<WorkerStat>[]> {
  try {
    const data = await json<any[]>(`${API_BASE}/runtime`);
    if (!Array.isArray(data)) return [];
    return data.map(d => ({
      workerId: d.worker_id || d.workerId,
      tokens: d.tokens,
      capacity: d.capacity,
      refillRatePerSec: d.refillRatePerSec,
      scalingFactor: d.scalingFactor,
      currentConcurrency: d.currentConcurrency,
      emaLatencyMs: d.emaLatencyMs,
      requestsPerMin: d.requestsPerMin,
      parcelsPerMin: d.parcelsPerMin,
      microDelay: d.microDelay,
        theoreticalParcelsPerMin: d.theoreticalParcelsPerMin,
        version: d.version,
      lastSeen: d.timestamp
    }));
  } catch (_) { return []; }
}

// Combined fetch utility
export async function fetchCombinedWorkers(): Promise<WorkerStat[]> {
  const [base, runtime] = await Promise.all([
    fetchWorkers(),
    fetchRuntimeMetrics()
  ]);
  const runtimeMap = new Map(runtime.map(r => [r.workerId, r]));
  return base.map(b => ({ ...b, ...(runtimeMap.get(b.workerId) || {}) }));
}

// Preferred unified endpoint if available
export async function fetchAllWorkers(): Promise<WorkerStat[]> {
  try {
    // Prefer extended endpoint if present
    const extended = await json<any>(`${API_BASE}/workers-extended`);
    if (extended && Array.isArray(extended.workers)) {
      const merged: WorkerStat[] = extended.workers.map((d: any) => ({
        workerId: d.worker_id || d.workerId,
        processed: d.processed ?? 0,
        errors: d.errors ?? 0,
        tokens: d.tokens,
        capacity: d.capacity,
        refillRatePerSec: d.refillRatePerSec,
        currentConcurrency: d.currentConcurrency,
        emaLatencyMs: d.emaLatencyMs,
        requestsPerMin: d.requestsPerMin,
        parcelsPerMin: d.parcelsPerMin,
        scalingFactor: d.scalingFactor,
        microDelay: d.microDelay,
        theoreticalParcelsPerMin: d.theoreticalParcelsPerMin,
        tokenTheoreticalParcelsPerMin: d.tokenTheoreticalParcelsPerMin,
        latencyTheoreticalParcelsPerMin: d.latencyTheoreticalParcelsPerMin,
        effectiveTheoreticalParcelsPerMin: d.effectiveTheoreticalParcelsPerMin,
        utilizationPct: (d.utilization != null ? d.utilization * 100 : (d.theoreticalParcelsPerMin ? (d.parcelsPerMin / d.theoreticalParcelsPerMin) * 100 : undefined)),
        dynamicBatchSize: d.dynamicBatchSize,
        inFlightRequests: d.inFlightRequests,
        lastBatchDurationMs: d.lastBatchDurationMs,
        localQueueLength: d.localQueueLength,
        internalParallelism: d.internalParallelism,
        pipelineOverlaps: d.pipelineOverlaps,
        lastBatchOverlapMs: d.lastBatchOverlapMs,
        avgBatchOverlapMs: d.avgBatchOverlapMs,
        version: d.version,
        lastSeen: d.lastSeen
      }));
      // Attach allocation meta so dashboard can show global pool state (store inside a synthetic worker or attach to global variable later)
      (merged as any).__allocation = extended.allocation;
      return merged;
    }
  } catch (_) {
    // fall through to legacy endpoints
  }
  try {
    const data = await json<any[]>(`${API_BASE}/workers`);
    if (!Array.isArray(data)) return fetchCombinedWorkers();
    return data.map(d => ({
      workerId: d.worker_id || d.workerId,
      processed: d.processed ?? 0,
      errors: d.errors ?? 0,
      tokens: d.tokens,
      capacity: d.capacity,
      refillRatePerSec: d.refillRatePerSec,
      currentConcurrency: d.currentConcurrency,
      emaLatencyMs: d.emaLatencyMs,
      requestsPerMin: d.requestsPerMin,
      parcelsPerMin: d.parcelsPerMin,
      scalingFactor: d.scalingFactor,
      microDelay: d.microDelay,
      theoreticalParcelsPerMin: d.theoreticalParcelsPerMin,
      utilizationPct: (d.utilization != null ? d.utilization * 100 : (d.theoreticalParcelsPerMin ? (d.parcelsPerMin / d.theoreticalParcelsPerMin) * 100 : undefined)),
      version: d.version,
      lastSeen: d.lastSeen
    }));
  } catch (_) {
    return fetchCombinedWorkers();
  }
}

// Dynamic configuration endpoints
export interface DynamicConfigResponse { config: { [k: string]: any } }

export async function fetchConfig(): Promise<DynamicConfigResponse> {
  return json<DynamicConfigResponse>(`${API_BASE}/config`);
}

// Fetch allocation / pool status for diagnostics
export async function fetchAllocationStatus(): Promise<any> {
  return json<any>(`${API_BASE}/allocation-status`);
}

// Convenience ping that returns both stats and allocation status
export async function pingCollector(): Promise<{ stats?: StatsResponse; allocation?: any }> {
  const [stats, allocation] = await Promise.allSettled([fetchStats(), fetchAllocationStatus()]);
  const out: any = {};
  if (stats.status === 'fulfilled') out.stats = stats.value;
  else out.statsError = (stats as any).reason?.message || String((stats as any).reason);
  if (allocation.status === 'fulfilled') out.allocation = allocation.value;
  else out.allocationError = (allocation as any).reason?.message || String((allocation as any).reason);
  return out;
}

export async function updateConfig(update: Partial<{ INTERNAL_PARALLEL: number; PIPELINE_TRIGGER_FRACTION: number }>, token?: string): Promise<DynamicConfigResponse> {
  const res = await fetch(`${API_BASE}/config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(update)
  });
  if (!res.ok) throw new Error(`Failed to update config ${res.status}`);
  return res.json();
}
