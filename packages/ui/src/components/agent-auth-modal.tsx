import { useEffect, useState } from 'react';
import {
  authenticateAgentServer,
  type AgentAuthenticationMethod,
  type AgentAuthenticationStatus,
} from '../api';
import { Icon } from './icon';

interface AgentAuthModalProps {
  statuses: AgentAuthenticationStatus[];
  onClose: () => void;
  onReady: () => void | Promise<void>;
  onChanged?: () => void;
}

export function AgentAuthModal({ statuses: initialStatuses, onClose, onReady, onChanged }: AgentAuthModalProps) {
  const [statuses, setStatuses] = useState(initialStatuses);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setStatuses(initialStatuses);
  }, [initialStatuses]);

  async function runAuth(status: AgentAuthenticationStatus, method: AgentAuthenticationMethod) {
    setBusy(`${status.agentServerId}:${method.id}`);
    try {
      const env = method.type === 'env_var'
        ? Object.fromEntries(method.vars
            .map((variable) => [
              variable.name,
              values[authValueKey(status.agentServerId, method.id, variable.name)]?.trim() ?? '',
            ])
            .filter(([name, value]) => Boolean(name) && Boolean(value)))
        : {};
      const updated = await authenticateAgentServer(status.agentServerId, method.id, env);
      const nextStatuses = statuses.map((candidate) =>
        candidate.agentServerId === updated.agentServerId ? updated : candidate,
      );
      setStatuses(nextStatuses);
      onChanged?.();
      setError('');
      if (nextStatuses.every((candidate) => !candidate.needsAuth)) {
        await onReady();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  function updateValue(status: AgentAuthenticationStatus, method: AgentAuthenticationMethod, name: string, value: string) {
    setValues((current) => ({
      ...current,
      [authValueKey(status.agentServerId, method.id, name)]: value,
    }));
  }

  return (
    <div className="run-modal-overlay agent-auth-overlay" onMouseDown={onClose}>
      <div className="agent-auth-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="run-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label"><Icon name="lock" size={11} /> ACP auth</div>
            <h2>Authenticate agents</h2>
          </div>
          <button className="close" onClick={onClose} title="Close">
            <Icon name="x" size={14} />
          </button>
        </div>

        {error && <div className="agent-server-error">{error}</div>}

        <div className="agent-auth-status-list">
          {statuses.filter((status) => status.needsAuth).map((status) => (
            <section className="agent-auth-status" key={status.agentServerId}>
              <div className="agent-server-title">
                <span>{status.agentServerId}</span>
                <span className="cap-badge update">auth required</span>
              </div>

              {status.methods.length === 0 && (
                <div className="agent-server-desc">The agent requires ACP authentication but did not advertise a method.</div>
              )}

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
                            onChange={(event) => updateValue(status, method, variable.name, event.target.value)}
                          />
                        </label>
                      ))}
                      {method.missingVars.length > 0 && (
                        <div className="agent-auth-missing">Missing {method.missingVars.join(', ')}</div>
                      )}
                    </div>
                  )}

                  {method.type === 'terminal' && !method.terminalEnabled && (
                    <div className="agent-auth-missing">Terminal auth is disabled for this server.</div>
                  )}

                  <button
                    className="btn sm primary"
                    disabled={busy === `${status.agentServerId}:${method.id}` || (method.type === 'terminal' && !method.terminalEnabled)}
                    onClick={() => runAuth(status, method)}
                  >
                    <Icon name={method.type === 'env_var' ? 'check' : 'external'} size={10} />
                    {busy === `${status.agentServerId}:${method.id}`
                      ? 'Checking auth...'
                      : method.type === 'env_var' ? 'Save key and auth' : 'Authenticate'}
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function authValueKey(id: string, methodId: string, name: string): string {
  return `${id}:${methodId}:${name}`;
}
