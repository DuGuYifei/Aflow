import { useEffect, useRef, type ReactNode } from 'react';

type FloatingTooltipPlacement = 'top' | 'right' | 'bottom' | 'left';

interface FloatingTooltipProps {
  content: string;
  children: ReactNode;
  placement?: FloatingTooltipPlacement;
  multiline?: boolean;
}

interface TooltipPosition {
  left: number;
  top: number;
  placement: FloatingTooltipPlacement;
}

const GAP = 8;
const VIEWPORT_MARGIN = 8;

export function FloatingTooltip({
  content,
  children,
  placement = 'top',
  multiline = false,
}: FloatingTooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return undefined;
    let tooltip: HTMLDivElement | undefined;

    const positionTooltip = () => {
      if (!tooltip) return;
      const triggerRect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
      const next = calculateTooltipPosition(
        triggerRect,
        tooltip.offsetWidth || 220,
        tooltip.offsetHeight || 32,
        viewportWidth,
        viewportHeight,
        placement,
      );
      tooltip.style.left = `${next.left}px`;
      tooltip.style.top = `${next.top}px`;
      tooltip.dataset.placement = next.placement;
    };

    const hideTooltip = () => {
      if (!tooltip) return;
      window.removeEventListener('resize', positionTooltip);
      window.removeEventListener('scroll', positionTooltip, true);
      tooltip.remove();
      tooltip = undefined;
    };

    const showTooltip = () => {
      if (!content || tooltip) return;
      tooltip = document.createElement('div');
      tooltip.className = `floating-tooltip${multiline ? ' multiline' : ''}`;
      tooltip.setAttribute('role', 'tooltip');
      tooltip.textContent = content;
      tooltip.style.position = 'fixed';
      tooltip.style.zIndex = '1000';
      document.body.appendChild(tooltip);
      positionTooltip();
      window.addEventListener('resize', positionTooltip);
      window.addEventListener('scroll', positionTooltip, true);
    };

    const hideWhenLeaving = (event: MouseEvent) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget && trigger.contains(nextTarget as Node)) return;
      hideTooltip();
    };

    trigger.addEventListener('mouseover', showTooltip);
    trigger.addEventListener('mouseout', hideWhenLeaving);
    trigger.addEventListener('focusin', showTooltip);
    trigger.addEventListener('focusout', hideTooltip);
    trigger.dataset.floatingTooltipReady = 'true';
    return () => {
      trigger.removeEventListener('mouseover', showTooltip);
      trigger.removeEventListener('mouseout', hideWhenLeaving);
      trigger.removeEventListener('focusin', showTooltip);
      trigger.removeEventListener('focusout', hideTooltip);
      delete trigger.dataset.floatingTooltipReady;
      hideTooltip();
    };
  }, [content, multiline, placement]);

  return (
    <span ref={triggerRef} className="floating-tooltip-trigger">
      {children}
    </span>
  );
}

function calculateTooltipPosition(
  trigger: DOMRect,
  tooltipWidth: number,
  tooltipHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  preferredPlacement: FloatingTooltipPlacement,
): TooltipPosition {
  const candidates = placementCandidates(preferredPlacement);
  for (const candidate of candidates) {
    const position = rawPosition(trigger, tooltipWidth, tooltipHeight, candidate);
    if (
      position.left >= VIEWPORT_MARGIN
      && position.top >= VIEWPORT_MARGIN
      && position.left + tooltipWidth <= viewportWidth - VIEWPORT_MARGIN
      && position.top + tooltipHeight <= viewportHeight - VIEWPORT_MARGIN
    ) {
      return { ...position, placement: candidate };
    }
  }
  const fallback = rawPosition(trigger, tooltipWidth, tooltipHeight, preferredPlacement);
  return {
    placement: preferredPlacement,
    left: clamp(fallback.left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportWidth - tooltipWidth - VIEWPORT_MARGIN)),
    top: clamp(fallback.top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportHeight - tooltipHeight - VIEWPORT_MARGIN)),
  };
}

function placementCandidates(preferred: FloatingTooltipPlacement): FloatingTooltipPlacement[] {
  if (preferred === 'right') return ['right', 'left', 'bottom', 'top'];
  if (preferred === 'left') return ['left', 'right', 'bottom', 'top'];
  if (preferred === 'bottom') return ['bottom', 'top', 'right', 'left'];
  return ['top', 'bottom', 'right', 'left'];
}

function rawPosition(
  trigger: DOMRect,
  tooltipWidth: number,
  tooltipHeight: number,
  placement: FloatingTooltipPlacement,
): Omit<TooltipPosition, 'placement'> {
  if (placement === 'right') {
    return {
      left: trigger.right + GAP,
      top: trigger.top + (trigger.height - tooltipHeight) / 2,
    };
  }
  if (placement === 'left') {
    return {
      left: trigger.left - tooltipWidth - GAP,
      top: trigger.top + (trigger.height - tooltipHeight) / 2,
    };
  }
  if (placement === 'bottom') {
    return {
      left: trigger.left + (trigger.width - tooltipWidth) / 2,
      top: trigger.bottom + GAP,
    };
  }
  return {
    left: trigger.left + (trigger.width - tooltipWidth) / 2,
    top: trigger.top - tooltipHeight - GAP,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
