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
import type { OwnerData } from '../util/database';

interface DatabaseTableProps {
  data: OwnerData[];
  loading: boolean;
  error: string | null;
  currentPage: number;
  totalPages: number;
  searchTerm: string;
  onPageChange: (page: number) => void;
  onSearchChange: (search: string) => void;
}

export const DatabaseTable: React.FC<DatabaseTableProps> = ({
  data,
  loading,
  error,
  currentPage,
  totalPages,
  searchTerm,
  onPageChange,
  onSearchChange
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

  const formatValue = (value: string | null) => {
    return value || 'N/A';
  };

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
        {/* Search Controls */}
        <Flex gap="3" align="center">
          <TextField.Root style={{ flexGrow: 1 }}>
            <TextField.Input
              placeholder="Search by owner, address, or parcel ID..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </TextField.Root>
          <Text size="2" color="gray">
            {data.length} records
          </Text>
        </Flex>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Parcel ID</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Owner Name</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Property Address</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Market Value</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Property Type</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Acreage</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Last Updated</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>

            <Table.Body>
              {loading ? (
                <Table.Row>
                  <Table.Cell colSpan={8}>
                    <Flex justify="center" p="4">
                      <Text size="2">Loading...</Text>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ) : data.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={8}>
                    <Flex justify="center" p="4">
                      <Text size="2" color="gray">
                        No data found
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
                      <Text size="2">{formatValue(item.owner_name)}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2">{formatValue(item.property_address)}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2">
                        {item.market_value ? `$${item.market_value}` : 'N/A'}
                        {item.market_value_year && (
                          <Text size="1" color="gray" style={{ display: 'block' }}>
                            ({item.market_value_year})
                          </Text>
                        )}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2">{formatValue(item.property_type)}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2">{formatValue(item.total_acreage)}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge color={getStatusColor(item.scrape_status)} size="1">
                        {item.scrape_status}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="1" color="gray">
                        {new Date(item.last_updated).toLocaleDateString()}
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