import type { TimelineEvent, WorkflowNode } from '../types';
import { useI18n } from '../i18n';
import { buildTimelineItems } from '../acp-timeline';

interface SessionTimelineProps {
  events: TimelineEvent[];
  emptyMessage?: string;
  nodeById?: Map<string, WorkflowNode>;
}

export function SessionTimeline({ events, emptyMessage = 'No output yet.', nodeById }: SessionTimelineProps) {
  const { t } = useI18n();
  const items = buildTimelineItems(events);
  if (items.length === 0) return <div className="history-empty">{emptyMessage === 'No output yet.' ? t('timeline.empty') : emptyMessage}</div>;
  return (
    <>
      {items.map((item, index) => {
        if (item.kind === 'tool') {
          return (
            <div key={index} className="timeline-tool">
              <span className="timeline-role">{t('timeline.tool')}</span>
              {item.nodeId && nodeById?.get(item.nodeId) && <span className="node-ref">{nodeById.get(item.nodeId)!.alias}</span>}
              <span className="timeline-tool-title">{item.title}</span>
              {item.status && <span className="timeline-tool-status">{item.status}</span>}
            </div>
          );
        }
        if (item.kind === 'plan') {
          return (
            <div key={index} className="timeline-plan">
              <span className="timeline-role">{t('timeline.plan')}</span>
              <div className="timeline-plan-entries">
                {item.entries.map((entry, entryIndex) => (
                  <div key={entryIndex}>
                    {entry.status && <span className={`timeline-plan-status ${entry.status}`}>{entry.status}</span>}
                    {entry.content}
                  </div>
                ))}
              </div>
            </div>
          );
        }
        if (item.kind === 'gate') {
          return (
            <div key={index} className="timeline-gate">
              <div className="timeline-gate-head">
                <span className="timeline-role">{t('timeline.gate')}</span>
                {item.nodeId && nodeById?.get(item.nodeId) && <span className="node-ref">{nodeById.get(item.nodeId)!.alias}</span>}
                <span className="timeline-gate-choice">{item.branchId}</span>
              </div>
              {item.reason && <div className="timeline-gate-reason">{item.reason}</div>}
              {item.branches && (
                <div className="timeline-gate-branches">
                  {item.branches.map((branch) => (
                    <span key={branch.branchId} className={`timeline-gate-branch${branch.available ? '' : ' exhausted'}${branch.branchId === item.branchId ? ' chosen' : ''}`}>
                      {branch.label} {formatBranchTraversal(branch)}{branch.available ? '' : ` ${t('timeline.exhausted')}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        }
        const node = item.nodeId ? nodeById?.get(item.nodeId) : undefined;
        return (
          <div key={index} className={`timeline-message ${item.role}${item.stream ? ` ${item.stream}` : ''}${item.localContext ? ' local-context' : ''}`}>
            <span className="timeline-role">{item.role === 'terminal' && item.stream ? item.stream : item.role}</span>
            {node && <span className="node-ref">{node.alias}</span>}
            <span className="timeline-text">{item.text}</span>
          </div>
        );
      })}
    </>
  );
}

export { buildTimelineItems } from '../acp-timeline';

function formatBranchTraversal(branch: { traversalsUsed: number; maxTraversals: number }): string {
  const limit = branch.maxTraversals >= Number.MAX_SAFE_INTEGER ? '∞' : String(branch.maxTraversals);
  return `${branch.traversalsUsed}/${limit}`;
}
