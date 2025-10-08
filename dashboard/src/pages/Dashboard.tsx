/// <reference types="react" />
import React from 'react';
import { Flex, Grid, Card, Text } from '@radix-ui/themes';
// Radix progress might have missing type resolution in current setup; fallback simple bar if import fails at runtime
// declare module in case type declarations missing
// @ts-ignore
import * as Progress from '@radix-ui/react-progress';
import { usePolling } from '../util/usePolling';
import { fetchStats, fetchAllWorkers, StatsResponse, WorkerStat } from '../util/api';
import { MetricCard } from '../components/MetricCard';
import { WorkersTable } from '../components/WorkersTable';
import { ConfigPanel } from '../components/ConfigPanel';
import { UtilizationCard } from '../components/UtilizationCard';
import { DebugPanel } from '../components/DebugPanel';

const TOTAL_PARCELS = 391099; // TODO: derive from server if exposed

export const Dashboard: React.FC = () => {
  const { data: stats, error: statsError } = usePolling<StatsResponse>(fetchStats, 4000);
  const { data: workers, error: workersError } = usePolling<WorkerStat[]>(fetchAllWorkers, 5000);

  const completed = stats?.completedParcels ?? stats?.totalStored ?? 0;
  const remaining = stats?.remainingParcels ?? (TOTAL_PARCELS - completed);
  const total = stats?.totalParcels ?? TOTAL_PARCELS;
  const percent = total ? (completed / total) * 100 : 0;
  // Aggregate dynamic throughput metrics if worker data present
  let aggActual = 0, aggEff = 0, aggToken = 0, aggLatency = 0;
  let aggInternalPar = 0, workersWithPar = 0, aggOverlap = 0, overlapSamples = 0;
  if (Array.isArray(workers)) {
    for (const w of workers) {
      aggActual += w.parcelsPerMin || 0;
      aggEff += (w.theoreticalParcelsPerMin || 0);
      aggToken += (w.tokenTheoreticalParcelsPerMin || 0);
      aggLatency += (w.latencyTheoreticalParcelsPerMin || 0);
      if (w.internalParallelism) { aggInternalPar += w.internalParallelism; workersWithPar++; }
      if (w.avgBatchOverlapMs != null) { aggOverlap += w.avgBatchOverlapMs; overlapSamples++; }
    }
  }
  const aggUtilPct = aggEff > 0 ? (aggActual / aggEff) * 100 : 0;
  const avgInternalPar = workersWithPar ? (aggInternalPar / workersWithPar) : 0;
  const avgOverlapMs = overlapSamples ? (aggOverlap / overlapSamples) : 0;

  return (
    <Flex direction="column" gap="4">
      <Grid columns={{ initial: '1', sm: '2', md: '3', lg: '7' }} gap="3">
        <MetricCard label="Completed" value={completed.toLocaleString()} subtitle={`${percent.toFixed(2)}%`} />
  <MetricCard label="Remaining" value={remaining.toLocaleString()} />
        <MetricCard label="Errors" value={(stats?.totalErrors || 0).toString()} />
        <MetricCard label="Received" value={(stats?.totalReceived || 0).toString()} />
        <MetricCard label="Stored" value={(stats?.totalStored || 0).toString()} />
        {stats?.currentConcurrency !== undefined && (
          <MetricCard label="Concurrency" value={stats.currentConcurrency} />
        )}
        {stats?.emaLatencyMs !== undefined && (
          <MetricCard label="EMA Latency" value={Math.round(stats.emaLatencyMs)} subtitle="ms" />
        )}
        {stats?.requestsPerMin !== undefined && (
          <MetricCard label="Req/min" value={Math.round(stats.requestsPerMin)} />
        )}
        {stats?.parcelsPerMin !== undefined && (
          <MetricCard label="Parcels/min" value={Math.round(stats.parcelsPerMin)} />
        )}
        {Array.isArray(workers) && workers.length > 0 && (
          <>
            <MetricCard label="Actual PPM" value={Math.round(aggActual)} />
            <MetricCard label="Eff Theo PPM" value={Math.round(aggEff)} />
            <MetricCard label="Token Theo PPM" value={Math.round(aggToken)} />
            <MetricCard label="Lat Theo PPM" value={Math.round(aggLatency)} />
            <MetricCard label="Util %" value={aggUtilPct.toFixed(1)} />
            <MetricCard label="Avg IntPar" value={avgInternalPar.toFixed(1)} />
            <MetricCard label="Avg Overlap" value={Math.round(avgOverlapMs)} subtitle="ms" />
          </>
        )}
      </Grid>
      <Card>
        <Flex direction="column" gap="3">
          <Text weight="bold">Overall Progress</Text>
          <Progress.Root value={percent} style={{ position: 'relative', overflow: 'hidden', background: 'var(--gray-4)', borderRadius: 4, height: 10 }}>
            <Progress.Indicator style={{ width: `${percent}%`, background: 'var(--accent-9)', height: '100%', transition: 'width 300ms' }} />
          </Progress.Root>
          {statsError && <Text color="red" size="1">Stats Error: {statsError.message}</Text>}
        </Flex>
      </Card>
      {Array.isArray(workers) && workers.length > 0 && (
        (() => {
          const allocation = (workers as any).__allocation;
          return (
            <>
              <UtilizationCard workers={workers} />
              <ConfigPanel />
              <DebugPanel />
              {allocation && (
                <Card>
                  <Flex direction="column" gap="2">
                    <Text weight="bold">Allocation Pool</Text>
                    <Text size="2">Pool Size: {allocation.poolSize} / Target {allocation.target} (Min {allocation.min})</Text>
                    <Text size="2">Allocated Active: {allocation.allocatedSize}</Text>
                    <Text size="1" color="gray">Global Served: {allocation.stats?.totalGlobalServed || 0} | Reallocate Served: {allocation.stats?.reallocateServed || 0} | Total Alloc: {allocation.stats?.totalAllocations || 0}</Text>
                    <Text size="1" color="gray">Pool Refills: {allocation.stats?.poolRefills || 0} | Empty Hits: {allocation.stats?.poolHitsEmpty || 0}</Text>
                  </Flex>
                </Card>
              )}
            </>
          );
        })()
      )}
      {workersError && <Text color="red" size="1">Workers Error: {workersError.message}</Text>}
      <WorkersTable workers={(workers as any) || []} />
    </Flex>
  );
};
