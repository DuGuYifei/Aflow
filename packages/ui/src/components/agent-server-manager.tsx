import { useEffect, useMemo, useState } from 'react';
import {
  fetchAgentRegistry,
  fetchAgentServers,
  removeAgentServer,
  saveAgentServer,
  type AgentServerEntry,
  type RegistryAgent,
} from '../api';
import { Icon } from './icon';

interface AgentServerManagerProps {
  onClose: () => void;
  onChanged?: () => void;
}

export function AgentServerManager({ onClose, onChanged }: AgentServerManagerProps) {
  const [servers, setServers] = useState<AgentServerEntry[]>([]);
  const [registry, setRegistry] = useState<RegistryAgent[]>([]);
  const [tab, setTab] = useState<'registry' | 'custom'>('registry');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [customId, setCustomId] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [customArgs, setCustomArgs] = useState('');
  const [customEnv, setCustomEnv] = useState('');
  const [customAdditionalDirs, setCustomAdditionalDirs] = useState('');
  const [customTerminalEnabled, setCustomTerminalEnabled] = useState(true);
  const [customTerminalAuth, setCustomTerminalAuth] = useState(false);
  const [customDefaultMode, setCustomDefaultMode] = useState('');
  const [customDefaultModel, setCustomDefaultModel] = useState('');
  const [customConfigOptions, setCustomConfigOptions] = useState('');

  const installed = useMemo(() => new Map(servers.map((server) => [server.id, server])), [servers]);

  useEffect(() => {
    void refreshAll();
  }, []);

  async function refreshAll() {
    try {
      setError('');
      const [serverList, registryIndex] = await Promise.all([
        fetchAgentServers(),
        fetchAgentRegistry(),
      ]);
      setServers(serverList);
      setRegistry(registryIndex.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function installRegistry(agent: RegistryAgent) {
    setBusy(agent.id);
    try {
      setServers(await saveAgentServer(agent.id, {
        type: 'registry',
        registryId: agent.id,
      }));
      onChanged?.();
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      setServers(await removeAgentServer(id));
      onChanged?.();
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function saveCustom() {
    const id = customId.trim();
    const command = customCommand.trim();
    if (!id || !command) return;
    setBusy(id);
    try {
      setServers(await saveAgentServer(id, {
        type: 'custom',
        command,
        args: splitArgs(customArgs),
        env: parseEnv(customEnv),
        additionalDirectories: splitLines(customAdditionalDirs),
        terminal: { enabled: customTerminalEnabled, auth: customTerminalAuth },
        defaultMode: customDefaultMode.trim() || undefined,
        defaultModel: customDefaultModel.trim() || undefined,
        defaultConfigOptions: parseConfigOptions(customConfigOptions),
      }));
      setCustomId('');
      setCustomCommand('');
      setCustomArgs('');
      setCustomEnv('');
      setCustomAdditionalDirs('');
      setCustomTerminalEnabled(true);
      setCustomTerminalAuth(false);
      setCustomDefaultMode('');
      setCustomDefaultModel('');
      setCustomConfigOptions('');
      onChanged?.();
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="run-modal-overlay" onMouseDown={onClose}>
      <div className="agent-server-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="run-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label"><Icon name="settings" size={11} /> Agent servers</div>
            <h2>ACP agents</h2>
          </div>
          <button className="close" onClick={onClose} title="Close">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="agent-server-tabs">
          <button className={tab === 'registry' ? 'active' : ''} onClick={() => setTab('registry')}>
            <Icon name="list" size={11} />Registry
          </button>
          <button className={tab === 'custom' ? 'active' : ''} onClick={() => setTab('custom')}>
            <Icon name="terminal" size={11} />Custom ACP
          </button>
        </div>

        {error && <div className="agent-server-error">{error}</div>}

        {tab === 'registry' && (
          <div className="agent-server-list">
            {registry.map((agent) => {
              const isInstalled = installed.has(agent.id);
              return (
                <div className="agent-server-row" key={agent.id}>
                  <div className="agent-server-main">
                    <div className="agent-server-title">
                      <span>{agent.name || agent.id}</span>
                      <span className="mono-id">{agent.version}</span>
                      {isInstalled && <span className="cap-badge on">installed</span>}
                    </div>
                    <div className="agent-server-desc">{agent.description || agent.id}</div>
                    <div className="history-meta">
                      {Boolean(agent.distribution.binary) && <span>binary</span>}
                      {Boolean(agent.distribution.npx) && <span>npx</span>}
                      {Boolean(agent.distribution.uvx) && <span>uvx</span>}
                    </div>
                  </div>
                  <div className="agent-server-actions">
                    {agent.website && (
                      <a className="btn sm" href={agent.website} target="_blank" rel="noreferrer">
                        <Icon name="external" size={10} />Site
                      </a>
                    )}
                    {isInstalled ? (
                      <button className="btn sm" disabled={busy === agent.id} onClick={() => remove(agent.id)}>
                        <Icon name="trash" size={10} />Remove
                      </button>
                    ) : (
                      <button className="btn sm primary" disabled={busy === agent.id} onClick={() => installRegistry(agent)}>
                        <Icon name="plus" size={10} />Install
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'custom' && (
          <div className="agent-server-custom">
            <div className="agent-server-form">
              <input className="input" value={customId} onChange={(e) => setCustomId(e.target.value)} placeholder="id, e.g. my-agent" />
              <input className="input" value={customCommand} onChange={(e) => setCustomCommand(e.target.value)} placeholder="command, e.g. node" />
              <input className="input" value={customArgs} onChange={(e) => setCustomArgs(e.target.value)} placeholder="args, space separated" />
              <input className="input" value={customDefaultMode} onChange={(e) => setCustomDefaultMode(e.target.value)} placeholder="default mode, optional" />
              <input className="input" value={customDefaultModel} onChange={(e) => setCustomDefaultModel(e.target.value)} placeholder="default model, optional" />
              <textarea className="textarea code" value={customConfigOptions} onChange={(e) => setCustomConfigOptions(e.target.value)} placeholder="config option=value per line" rows={3} />
              <textarea className="textarea code" value={customAdditionalDirs} onChange={(e) => setCustomAdditionalDirs(e.target.value)} placeholder="additional allowed directory per line" rows={3} />
              <label className="agent-server-toggle">
                <input type="checkbox" checked={customTerminalEnabled} onChange={(e) => setCustomTerminalEnabled(e.target.checked)} />
                <span>Allow ACP terminal creation</span>
              </label>
              <label className="agent-server-toggle">
                <input type="checkbox" checked={customTerminalAuth} onChange={(e) => setCustomTerminalAuth(e.target.checked)} disabled={!customTerminalEnabled} />
                <span>Advertise terminal auth support</span>
              </label>
              <textarea className="textarea code" value={customEnv} onChange={(e) => setCustomEnv(e.target.value)} placeholder="ENV=value per line" rows={4} />
              <button className="btn primary" disabled={!customId.trim() || !customCommand.trim() || Boolean(busy)} onClick={saveCustom}>
                <Icon name="check" size={12} />Save custom ACP
              </button>
            </div>

            <div className="agent-server-list compact">
              {servers.map((server) => {
                if (server.settings.type !== 'custom') return null;
                return (
                  <div className="agent-server-row" key={server.id}>
                    <div className="agent-server-main">
                      <div className="agent-server-title">
                        <span>{server.id}</span>
                        <span className="mono-id">{server.settings.command}</span>
                      </div>
                      <div className="agent-server-desc">{server.settings.args?.join(' ') || 'no args'}</div>
                    </div>
                    <button className="btn sm" disabled={busy === server.id} onClick={() => remove(server.id)}>
                      <Icon name="trash" size={10} />Remove
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function splitLines(input: string): string[] {
  return input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function splitArgs(input: string): string[] {
  return input.split(/\s+/).map((part) => part.trim()).filter(Boolean);
}

function parseEnv(input: string): Record<string, string> {
  return Object.fromEntries(input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=');
      return index >= 0 ? [line.slice(0, index), line.slice(index + 1)] : [line, ''];
    }));
}

function parseConfigOptions(input: string): Record<string, string | boolean> {
  return Object.fromEntries(input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=');
      const key = index >= 0 ? line.slice(0, index) : line;
      const raw = index >= 0 ? line.slice(index + 1) : 'true';
      const value = raw === 'true' ? true : raw === 'false' ? false : raw;
      return [key, value];
    }));
}
