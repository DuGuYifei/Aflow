import { useEffect, useMemo, useState } from 'react';
import {
  authenticateAgentServer,
  fetchAgentServerAuth,
  fetchAgentRegistry,
  fetchAgentServers,
  removeAgentServer,
  saveAgentServer,
  type AgentAuthenticationMethod,
  type AgentAuthenticationStatus,
  type AgentServerEntry,
  type RegistryAgent,
} from '../api';
import { Icon } from './icon';

interface AgentServerManagerProps {
  onClose: () => void;
  onChanged?: () => void;
  autoInspectServerId?: string;
}

export function AgentServerManager({ onClose, onChanged, autoInspectServerId }: AgentServerManagerProps) {
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
  const [auth, setAuth] = useState<Record<string, AgentAuthenticationStatus>>({});
  const [authValues, setAuthValues] = useState<Record<string, string>>({});
  const [authMessage, setAuthMessage] = useState('');

  const installed = useMemo(() => new Map(servers.map((server) => [server.id, server])), [servers]);
  const installedRegistry = useMemo(() => {
    const byRegistryId = new Map<string, AgentServerEntry>();
    for (const server of servers) {
      if (server.settings.type === 'registry') byRegistryId.set(server.settings.registryId, server);
    }
    return byRegistryId;
  }, [servers]);

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    if (autoInspectServerId) void inspectAuth(autoInspectServerId);
  }, [autoInspectServerId]);

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
        installedVersion: agent.version,
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

  async function updateRegistry(agent: RegistryAgent, server: AgentServerEntry) {
    if (server.settings.type !== 'registry') return;
    setBusy(server.id);
    try {
      setServers(await saveAgentServer(server.id, {
        ...server.settings,
        installedVersion: agent.version,
      }));
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

  async function inspectAuth(id: string) {
    setBusy(`auth:${id}`);
    try {
      const status = await fetchAgentServerAuth(id);
      setAuth((current) => ({ ...current, [id]: status }));
      setAuthMessage(status.methods.length === 0 ? `${id} does not advertise ACP auth methods.` : '');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function runAuth(id: string, method: AgentAuthenticationMethod) {
    setBusy(`auth:${id}:${method.id}`);
    try {
      const env = method.type === 'env_var'
        ? Object.fromEntries(method.vars
            .map((variable) => [variable.name, authValues[authValueKey(id, method.id, variable.name)]?.trim() ?? ''])
            .filter(([name, value]) => Boolean(name) && Boolean(value)))
        : {};
      const status = await authenticateAgentServer(id, method.id, env);
      setAuth((current) => ({ ...current, [id]: status }));
      setAuthMessage(`${id} authentication request completed.`);
      setError('');
      await refreshAll();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  function updateAuthValue(id: string, methodId: string, name: string, value: string) {
    setAuthValues((current) => ({ ...current, [authValueKey(id, methodId, name)]: value }));
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
        {authMessage && <div className="agent-server-note">{authMessage}</div>}

        {tab === 'registry' && (
          <div className="agent-server-list">
            {registry.map((agent) => {
              const installedServer = installedRegistry.get(agent.id) ?? installed.get(agent.id);
              const isInstalled = Boolean(installedServer);
              const hasUpdate = Boolean(installedServer?.registry?.updateAvailable);
              return (
                <div className="agent-server-row" key={agent.id}>
                  <div className="agent-server-main">
                    <div className="agent-server-title">
                      <span>{agent.name || agent.id}</span>
                      <span className="mono-id">{agent.version}</span>
                      {isInstalled && <span className="cap-badge on">installed</span>}
                      {hasUpdate && <span className="cap-badge update">update</span>}
                    </div>
                    <div className="agent-server-desc">{agent.description || agent.id}</div>
                    <div className="history-meta">
                      {Boolean(agent.distribution.binary) && <span>binary</span>}
                      {Boolean(agent.distribution.npx) && <span>npx</span>}
                      {Boolean(agent.distribution.uvx) && <span>uvx</span>}
                      {installedServer?.registry?.installedVersion && (
                        <span>installed {installedServer.registry.installedVersion}</span>
                      )}
                    </div>
                    {installedServer && auth[installedServer.id] && (
                      <AuthPanel
                        status={auth[installedServer.id]}
                        values={authValues}
                        busy={busy}
                        onValue={updateAuthValue}
                        onAuthenticate={runAuth}
                      />
                    )}
                  </div>
                  <div className="agent-server-actions">
                    {agent.website && (
                      <a className="btn sm" href={agent.website} target="_blank" rel="noreferrer">
                        <Icon name="external" size={10} />Site
                      </a>
                    )}
                    {installedServer ? (
                      <>
                        <button className="btn sm" disabled={busy === `auth:${installedServer.id}`} onClick={() => inspectAuth(installedServer.id)}>
                          <Icon name="lock" size={10} />Auth
                        </button>
                        {hasUpdate && (
                          <button className="btn sm primary" disabled={busy === installedServer.id} onClick={() => updateRegistry(agent, installedServer)}>
                            <Icon name="check" size={10} />Update
                          </button>
                        )}
                        <button className="btn sm" disabled={busy === installedServer.id} onClick={() => remove(installedServer.id)}>
                          <Icon name="trash" size={10} />Remove
                        </button>
                      </>
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
                      {auth[server.id] && (
                        <AuthPanel
                          status={auth[server.id]}
                          values={authValues}
                          busy={busy}
                          onValue={updateAuthValue}
                          onAuthenticate={runAuth}
                        />
                      )}
                    </div>
                    <div className="agent-server-actions">
                      <button className="btn sm" disabled={busy === `auth:${server.id}`} onClick={() => inspectAuth(server.id)}>
                        <Icon name="lock" size={10} />Auth
                      </button>
                      <button className="btn sm" disabled={busy === server.id} onClick={() => remove(server.id)}>
                        <Icon name="trash" size={10} />Remove
                      </button>
                    </div>
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

interface AuthPanelProps {
  status: AgentAuthenticationStatus;
  values: Record<string, string>;
  busy: string;
  onValue: (id: string, methodId: string, name: string, value: string) => void;
  onAuthenticate: (id: string, method: AgentAuthenticationMethod) => void;
}

function AuthPanel({ status, values, busy, onValue, onAuthenticate }: AuthPanelProps) {
  if (status.methods.length === 0) return null;

  return (
    <div className="agent-auth-panel">
      {status.methods.map((method) => (
        <div className="agent-auth-method" key={method.id}>
          <div className="agent-auth-method-head">
            <span>{method.name}</span>
            <span className="mono-id">{method.type}</span>
            {method.type === 'env_var' && method.link && (
              <a href={method.link} target="_blank" rel="noreferrer" title={`${method.name} credentials`}>
                <Icon name="external" size={10} />
              </a>
            )}
          </div>
          {method.description && <div className="agent-server-desc">{method.description}</div>}
          {method.type === 'env_var' && (
            <div className="agent-auth-env">
              {method.vars.map((variable) => (
                <label key={variable.name}>
                  <span>{variable.label || variable.name}</span>
                  <input
                    className="input sm"
                    type={variable.secret ? 'password' : 'text'}
                    value={values[authValueKey(status.agentServerId, method.id, variable.name)] ?? ''}
                    placeholder={variable.optional ? `${variable.name}, optional` : variable.name}
                    onChange={(event) => onValue(status.agentServerId, method.id, variable.name, event.target.value)}
                  />
                </label>
              ))}
              {method.missingVars.length > 0 && <div className="agent-auth-missing">Missing {method.missingVars.join(', ')}</div>}
            </div>
          )}
          {method.type === 'terminal' && !method.terminalEnabled && (
            <div className="agent-auth-missing">Terminal auth is disabled for this server.</div>
          )}
          <button
            className="btn sm primary"
            disabled={busy === `auth:${status.agentServerId}:${method.id}` || (method.type === 'terminal' && !method.terminalEnabled)}
            onClick={() => onAuthenticate(status.agentServerId, method)}
          >
            <Icon name={method.type === 'env_var' ? 'check' : 'external'} size={10} />
            {method.type === 'env_var' ? 'Save key and auth' : 'Authenticate'}
          </button>
        </div>
      ))}
    </div>
  );
}

function authValueKey(id: string, methodId: string, name: string): string {
  return `${id}:${methodId}:${name}`;
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
