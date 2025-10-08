import React from 'react';
import { 
  Table, 
  Text, 
  Badge, 
  Card, 
  Flex,
  Button,
  TextField,
  Select
} from '@radix-ui/themes';
import type { WorkQueueItem } from '../util/database';

interface WorkQueueTableProps {
  data: WorkQueueItem[];
  loading: boolean;
  error: string | null;
  currentPage: number;
  totalPages: number;
  statusFilter: string;
  onPageChange: (page: number) => void;
  onStatusFilterChange: (status: string) => void;
}

export const WorkQueueTable: React.FC<WorkQueueTableProps> = ({
  data,
  loading,
  error,
  currentPage,
  totalPages,
  statusFilter,
  onPageChange,
  onStatusFilterChange
}) => {
  if (error) {
    return (
      <Card>
        <Flex justify="center" p="4">
          <Text color="red" size="2">
            Error loading data: {error}
          </Text>
        </Flex>
      </Card>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'green';
      case 'pending': return 'orange';
      case 'in_progress': return 'blue';
      case 'failed': return 'red';
      default: return 'gray';
    }
  };

  return (
    <Card>
      <Flex direction="column" gap="3">
        {/* Filter Controls */}
        <Flex gap="3" align="center">
          <Select.Root value={statusFilter} onValueChange={onStatusFilterChange}>
            <Select.Trigger placeholder="Filter by status" />
            <Select.Content>
              <Select.Item value="">All Statuses</Select.Item>
              <Select.Item value="pending">Pending</Select.Item>
              <Select.Item value="in_progress">In Progress</Select.Item>
              <Select.Item value="completed">Completed</Select.Item>
              <Select.Item value="failed">Failed</Select.Item>
            </Select.Content>
          </Select.Root>
          <Text size="2" color="gray">
            {data.length} items
          </Text>
        </Flex>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Parcel ID</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Assigned Worker</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Attempts</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Last Attempt</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Error Message</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Updated</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>

            <Table.Body>
              {loading ? (
                <Table.Row>
                  <Table.Cell colSpan={7}>
                    <Flex justify="center" p="4">
                      <Text size="2">Loading...</Text>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ) : data.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={7}>
                    <Flex justify="center" p="4">
                      <Text size="2" color="gray">
                        No queue items found
                      </Text>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ) : (
                data.map((item) => (
                  <Table.Row key={item.id}>
                    <Table.RowHeaderCell>
                      <Text size="2" weight="medium">
                        {item.parcel_id}
                      </Text>
                    </Table.RowHeaderCell>
                    <Table.Cell>
                      <Badge color={getStatusColor(item.status)} size="1">
                        {item.status}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2">{item.assigned_worker || 'N/A'}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2">{item.attempts}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2">
                        {item.last_attempt 
                          ? new Date(item.last_attempt).toLocaleString() 
                          : 'N/A'
                        }
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="1" color="red" style={{ maxWidth: '200px' }}>
                        {item.error_message || 'N/A'}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="1" color="gray">
                        {new Date(item.updated_at).toLocaleDateString()}
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table.Root>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <Flex justify="between" align="center" gap="2">
            <Button
              variant="soft"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(currentPage - 1)}
            >
              Previous
            </Button>
            
            <Text size="2" color="gray">
              Page {currentPage} of {totalPages}
            </Text>
            
            <Button
              variant="soft"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange(currentPage + 1)}
            >
              Next
            </Button>
          </Flex>
        )}
      </Flex>
    </Card>
  );
};