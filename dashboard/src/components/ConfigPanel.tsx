import React, { useEffect, useState } from 'react';
import { Card, Flex, Text, TextField, Button, Tooltip } from '@radix-ui/themes';
import { fetchConfig, updateConfig } from '../util/api';
import { pingCollector } from '../util/api';

interface ConfigValues {
  INTERNAL_PARALLEL?: number;
  PIPELINE_TRIGGER_FRACTION?: number;
}

export const ConfigPanel: React.FC<{ authToken?: string }> = ({ authToken }) => {
  const [config, setConfig] = useState<ConfigValues>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [token, setToken] = useState<string>(() => {
    // prefer prop, then env, then localStorage
    const fromEnv = (import.meta as any).env?.VITE_COLLECTOR_TOKEN;
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('collectorToken') : null;
    return authToken || fromEnv || stored || '';
  });
  useEffect(() => {
    if (token && typeof localStorage !== 'undefined') localStorage.setItem('collectorToken', token);
  }, [token]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const data = await fetchConfig();
      setConfig(data.config || {});
    } catch (e: any) {
      setError(e.message || 'Failed to load config');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<any>(null);

  async function ping() {
    setPinging(true); setPingResult(null);
    try {
      const r = await pingCollector();
      setPingResult(r);
    } catch (e: any) {
      setPingResult({ error: e.message || String(e) });
    } finally { setPinging(false); }
  }

  async function save() {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const payload: ConfigValues = {};
      if (config.INTERNAL_PARALLEL != null) payload.INTERNAL_PARALLEL = Number(config.INTERNAL_PARALLEL);
      if (config.PIPELINE_TRIGGER_FRACTION != null) payload.PIPELINE_TRIGGER_FRACTION = Number(config.PIPELINE_TRIGGER_FRACTION);
  const res = await updateConfig(payload, token || authToken);
      setConfig(res.config || {});
      setSuccess('Saved');
      setTimeout(()=> setSuccess(null), 2500);
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally { setSaving(false); }
  }

  function updateField<K extends keyof ConfigValues>(key: K, value: string) {
    setConfig(c => ({ ...c, [key]: value === '' ? undefined : (key === 'PIPELINE_TRIGGER_FRACTION' ? parseFloat(value) : parseInt(value)) }));
  }

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Text weight="bold">Runtime Worker Config</Text>
        {loading && <Text size="1">Loading...</Text>}
        {error && <Text size="1" color="red">{error}</Text>}
        <Flex direction="column" gap="2">
          <Tooltip content="Bearer token required for updating config (must match COLLECTOR_TOKEN on server).">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Text size="2">Auth Token</Text>
              <TextField.Root>
                <TextField.Input
                  type="password"
                  value={token}
                  placeholder="paste COLLECTOR_TOKEN"
                  onChange={(e: any) => setToken(e.target.value)} />
              </TextField.Root>
            </label>
          </Tooltip>
          <Tooltip content="Per-batch internal task fan-out (each still consumes tokens).">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Text size="2">INTERNAL_PARALLEL</Text>
              <TextField.Root>
                <TextField.Input
                  type="number"
                  min={1}
                  max={32}
                  value={config.INTERNAL_PARALLEL ?? ''}
                  onChange={(e: any) => updateField('INTERNAL_PARALLEL', e.target.value)}
                  placeholder="4" />
              </TextField.Root>
            </label>
          </Tooltip>
          <Tooltip content="Fraction of batch dispatched before triggering next-batch prefetch (0.05 - 0.95).">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Text size="2">PIPELINE_TRIGGER_FRACTION</Text>
              <TextField.Root>
                <TextField.Input
                  type="number"
                  step="0.05"
                  min={0.05}
                  max={0.95}
                  value={config.PIPELINE_TRIGGER_FRACTION ?? ''}
                  onChange={(e: any) => updateField('PIPELINE_TRIGGER_FRACTION', e.target.value)}
                  placeholder="0.5" />
              </TextField.Root>
            </label>
          </Tooltip>
        </Flex>
        <Flex gap="2" wrap="wrap">
          <Button disabled={loading} onClick={load} variant="soft">Reload</Button>
          <Button disabled={saving || !token} onClick={save}>{saving ? 'Saving...' : 'Save'}</Button>
          <Button disabled={pinging} onClick={ping} variant="soft">{pinging ? 'Pinging...' : 'Ping Collector'}</Button>
          {success && <Text size="1" color="green">{success}</Text>}
          {!token && <Text size="1" color="red">Token required to save</Text>}
        </Flex>
        {pingResult && (
          <Card>
            <Flex direction="column" gap="2">
              <Text weight="bold">Ping Result</Text>
              <Text size="1">Stats: {pingResult.stats ? 'OK' : (pingResult.statsError || 'error')}</Text>
              <Text size="1">Allocation: {pingResult.allocation ? `pool=${pingResult.allocation.poolSize}` : (pingResult.allocationError || 'error')}</Text>
            </Flex>
          </Card>
        )}
        <Text size="1" color="gray">Changes propagate every ~10s (worker config poll interval). Use with caution; extreme values can destabilize throughput.</Text>
      </Flex>
    </Card>
  );
};
