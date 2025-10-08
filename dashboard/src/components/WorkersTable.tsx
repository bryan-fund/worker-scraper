import React from 'react';
import { Card, Table, Text, Flex, Badge } from '@radix-ui/themes';

interface WorkerRow {
  workerId: string;
  processed?: number;
  errors?: number;
  avgLatencyMs?: number;
  emaLatencyMs?: number;
  currentConcurrency?: number;
  requestsPerMin?: number;
  parcelsPerMin?: number;
  version?: string;
  lastSeen?: string | number;
  tokens?: number;
  capacity?: number;
  refillRatePerSec?: number;
  scalingFactor?: number;
  microDelay?: number;
  tokenTheoreticalParcelsPerMin?: number;
  latencyTheoreticalParcelsPerMin?: number;
  theoreticalParcelsPerMin?: number;
  dynamicBatchSize?: number;
  inFlightRequests?: number;
  lastBatchDurationMs?: number;
  localQueueLength?: number;
  internalParallelism?: number;
  pipelineOverlaps?: number;
  lastBatchOverlapMs?: number;
  avgBatchOverlapMs?: number;
}

interface WorkersTableProps {
  workers: WorkerRow[];
}

export const WorkersTable: React.FC<WorkersTableProps> = ({ workers }) => {
  return (
    <Card>
      <Flex direction="column" gap="3">
        <Text weight="bold">Workers</Text>
        <Table.Root variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Worker</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Processed</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Errors</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>EMA Lat (ms)</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Req/min</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Parcels/min</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Conc</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Tokens</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Scaling</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Refill/s</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Util%</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Batch</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Queue</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Theo(token)</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Theo(lat)</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Theo(eff)</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>LastBatch(ms)</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>IntPar</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>PipeOv</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Overlap(ms)</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Version</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Last Seen</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {workers.map(w => {
              const tokenPct = (w.tokens != null && w.capacity) ? Math.min(1, Math.max(0, w.tokens / w.capacity)) : null;
              return (
                <Table.Row key={w.workerId}>
                  <Table.RowHeaderCell>{w.workerId}</Table.RowHeaderCell>
                  <Table.Cell>{w.processed ?? 0}</Table.Cell>
                  <Table.Cell>{w.errors ?? 0}</Table.Cell>
                  <Table.Cell>{w.emaLatencyMs != null ? Math.round(w.emaLatencyMs) : 0}</Table.Cell>
                  <Table.Cell>{w.requestsPerMin != null ? Math.round(w.requestsPerMin) : 0}</Table.Cell>
                  <Table.Cell>{w.parcelsPerMin != null ? Math.round(w.parcelsPerMin) : 0}</Table.Cell>
                  <Table.Cell>{w.currentConcurrency != null ? w.currentConcurrency : 0}</Table.Cell>
                  <Table.Cell>
                    {tokenPct != null ? (
                      <Flex direction="column" gap="1">
                        <Text size="1">{w.tokens}/{w.capacity}</Text>
                        <div style={{ background: '#222', height: 6, borderRadius: 3, overflow: 'hidden', width: 80 }}>
                          <div style={{ background: tokenPct > 0.5 ? '#4caf50' : tokenPct > 0.2 ? '#ffb300' : '#e53935', width: `${Math.round(tokenPct*100)}%`, height: '100%' }} />
                        </div>
                      </Flex>
                    ) : '-'}
                  </Table.Cell>
                  <Table.Cell>{w.scalingFactor ? w.scalingFactor.toFixed(2) : '-'}</Table.Cell>
                  <Table.Cell>{w.refillRatePerSec ?? '-'}</Table.Cell>
                  <Table.Cell>{(w as any).utilizationPct != null ? ((w as any).utilizationPct as number).toFixed(1) : '-'}</Table.Cell>
                  <Table.Cell>{w.dynamicBatchSize ?? '-'}</Table.Cell>
                  <Table.Cell>{w.localQueueLength ?? '-'}</Table.Cell>
                  <Table.Cell>{w.tokenTheoreticalParcelsPerMin ?? '-'}</Table.Cell>
                  <Table.Cell>{w.latencyTheoreticalParcelsPerMin ?? '-'}</Table.Cell>
                  <Table.Cell>{w.theoreticalParcelsPerMin ?? '-'}</Table.Cell>
                  <Table.Cell>{w.lastBatchDurationMs != null ? Math.round(w.lastBatchDurationMs) : '-'}</Table.Cell>
                  <Table.Cell>{w.internalParallelism ?? '-'}</Table.Cell>
                  <Table.Cell>{w.pipelineOverlaps ?? '-'}</Table.Cell>
                  <Table.Cell>{w.avgBatchOverlapMs != null ? Math.round(w.avgBatchOverlapMs) : (w.lastBatchOverlapMs != null ? Math.round(w.lastBatchOverlapMs) : '-')}</Table.Cell>
                  <Table.Cell>{w.version || '-'}</Table.Cell>
                  <Table.Cell>{w.lastSeen || '-'}</Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      </Flex>
    </Card>
  );
};
