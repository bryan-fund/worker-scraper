import React, { useState } from 'react';
import { Card, Flex, Button, Text } from '@radix-ui/themes';
import { pingCollector } from '../util/api';

export const DebugPanel: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function runPing() {
    setLoading(true);
    setError(null);
    try {
      const r = await pingCollector();
      setResult(r);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <Flex direction="column" gap="2">
        <Text weight="bold">Debug</Text>
        <Text size="2">Run a diagnostic ping to the collector (shows stats + allocation)</Text>
        <Flex gap="2">
          <Button onClick={runPing} disabled={loading}>{loading ? 'Running…' : 'Run Ping'}</Button>
          <Button variant="ghost" onClick={() => { setResult(null); setError(null); }}>
            Clear
          </Button>
        </Flex>
        {error && <Text color="red" size="1">Error: {error}</Text>}
        {result && (
          <pre style={{ maxHeight: 300, overflow: 'auto', background: '#0f172a', color: '#e6edf3', padding: 8, borderRadius: 4 }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </Flex>
    </Card>
  );
};

export default DebugPanel;
