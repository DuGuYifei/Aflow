import type { AgentServerCapabilities } from '../api';

type ConfigOption = NonNullable<AgentServerCapabilities['configOptions']>[number];
export type DesignConfigOptions = Record<string, string | boolean>;

export function reconcileDesignConfigOptions(
  capabilities: AgentServerCapabilities | undefined,
  current: DesignConfigOptions,
): DesignConfigOptions {
  const options = capabilities?.configOptions ?? [];
  if (options.length === 0) return {};

  const next: DesignConfigOptions = {};
  for (const option of options) {
    const value = current[option.id];
    if (isValidConfigOptionValue(option, value)) {
      next[option.id] = value;
    }
  }

  for (const option of options) {
    if (next[option.id] !== undefined || !isReasoningOption(option)) continue;
    const highValue = findHighOptionValue(option);
    if (highValue) next[option.id] = highValue;
  }

  return next;
}

function isValidConfigOptionValue(option: ConfigOption, value: string | boolean | undefined): boolean {
  if (value === undefined) return false;
  if (option.type === 'boolean') return typeof value === 'boolean';
  if (typeof value !== 'string') return false;
  return selectOptionValues(option).has(value);
}

function selectOptionValues(option: ConfigOption): Set<string> {
  const values = new Set<string>();
  if (!Array.isArray(option.options)) return values;
  for (const entry of option.options) {
    if ('group' in entry && Array.isArray(entry.options)) {
      for (const child of entry.options) values.add(child.value);
    } else if ('value' in entry) {
      values.add(entry.value);
    }
  }
  return values;
}

function isReasoningOption(option: ConfigOption): boolean {
  const id = option.id.toLowerCase();
  const category = option.category?.toLowerCase() ?? '';
  return category === 'thought_level'
    || id === 'reasoning'
    || id.includes('reasoning')
    || id.includes('thought');
}

function findHighOptionValue(option: ConfigOption): string | undefined {
  if (option.type !== 'select' || !Array.isArray(option.options)) return undefined;
  for (const entry of option.options) {
    if ('group' in entry && Array.isArray(entry.options)) {
      const value = findHighOptionValueInEntries(entry.options);
      if (value) return value;
    } else if ('value' in entry) {
      const value = findHighOptionValueInEntries([entry]);
      if (value) return value;
    }
  }
  return undefined;
}

function findHighOptionValueInEntries(entries: Array<{ value: string; name: string }>): string | undefined {
  return entries.find((entry) => {
    const value = entry.value.trim().toLowerCase();
    const name = entry.name.trim().toLowerCase();
    return value === 'high' || name === 'high';
  })?.value;
}
