import React from 'react';
import { Card, Flex, Text } from '@radix-ui/themes';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({ label, value, subtitle }) => {
  return (
    <Card size="2" variant="surface">
      <Flex direction="column" gap="1">
        <Text size="1" color="gray" weight="bold">{label}</Text>
        <Text size="5" weight="bold">{value}</Text>
        {subtitle && <Text size="2" color="gray">{subtitle}</Text>}
      </Flex>
    </Card>
  );
};
