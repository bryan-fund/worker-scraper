import React from 'react';
import { createRoot } from 'react-dom/client';
import '@radix-ui/themes/styles.css';
import { Theme, Flex, Box, Heading } from '@radix-ui/themes';
import { Dashboard } from './pages/Dashboard';
// Workaround ambient declarations (should not be necessary but ensures TS picks modules)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare module './pages/Dashboard';
declare module './components/WorkersTable';
declare module './util/api';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Theme accentColor="indigo" grayColor="slate" radius="small" scaling="95%">
      <Flex direction="column" p="3" gap="4" style={{ minHeight: '100vh' }}>
        <Box>
          <Heading size="6">Salt Lake County Scraper Dashboard</Heading>
        </Box>
        <Dashboard />
      </Flex>
    </Theme>
  </React.StrictMode>
);
