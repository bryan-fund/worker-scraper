import React from 'react';
import { Card, Flex, Text } from '@radix-ui/themes';

interface UtilizationCardProps {
  workers: Array<{
    parcelsPerMin?: number;
    theoreticalParcelsPerMin?: number;
    tokenTheoreticalParcelsPerMin?: number;
    latencyTheoreticalParcelsPerMin?: number;
  }>;
}

export const UtilizationCard: React.FC<UtilizationCardProps> = ({ workers }) => {
  const actual = workers.reduce((sum, w) => sum + (w.parcelsPerMin || 0), 0);
  const tokenTheo = workers.reduce((sum, w) => sum + (w.tokenTheoreticalParcelsPerMin || 0), 0);
  const latencyTheo = workers.reduce((sum, w) => sum + (w.latencyTheoreticalParcelsPerMin || 0), 0);
  const effective = workers.reduce((sum, w) => sum + (w.theoreticalParcelsPerMin || 0), 0);
  const utilization = effective > 0 ? (actual / effective) : 0;
  const pct = (utilization * 100).toFixed(1);
  return (
    <Card>
      <Flex direction="column" gap="2">
        <Text weight="bold">Throughput Utilization</Text>
        <Text size="1" color="gray">Actual vs effective (min(token, latency)) theoretical</Text>
        <Flex direction="column" gap="1">
          <div style={{ background: 'var(--gray-4)', height: 10, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, utilization * 100)}%`, background: utilization > 0.75 ? 'var(--green-9)' : utilization > 0.5 ? 'var(--amber-9)' : 'var(--red-9)', height: '100%', transition: 'width 300ms' }} />
          </div>
          <Text size="2">Actual {actual.toFixed(0)} ppm | Eff {effective.toFixed(0)} | Token {tokenTheo.toFixed(0)} | Lat {latencyTheo.toFixed(0)} ({pct}%)</Text>
        </Flex>
      </Flex>
    </Card>
  );
};
