import { useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import { getThemeMode, setThemeMode, type ThemeMode } from './theme';

const options = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const;

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode);

  return (
    <div
      className={compact ? 'theme-toggle compact' : 'theme-toggle'}
      role="group"
      aria-label="Color theme"
    >
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className={mode === value ? 'active' : undefined}
          onClick={() => {
            setThemeMode(value);
            setMode(value);
          }}
          title={`${label} theme`}
          aria-pressed={mode === value}
        >
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
