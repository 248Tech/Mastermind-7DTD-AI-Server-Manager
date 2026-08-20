const MAX_BOUND = 1_000_000;

export function allowedAllocsConsoleCommand(command: unknown): string | null {
  if (typeof command !== 'string') return null;
  const trimmed = command.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > 200) return null;
  if (/^visitmap stop$/i.test(trimmed)) return 'visitmap stop';
  const bounds = /^visitmap (-?\d+) (-?\d+) (-?\d+) (-?\d+)$/i.exec(trimmed);
  if (!bounds) return null;
  const nums = bounds.slice(1).map(Number);
  if (!nums.every((value) => Number.isInteger(value) && Math.abs(value) <= MAX_BOUND)) return null;
  return `visitmap ${nums.join(' ')}`;
}

export function consoleResultText(json: unknown): string {
  if (typeof json === 'string') return json.slice(0, 4000);
  if (!json || typeof json !== 'object') return '';
  const record = json as Record<string, unknown>;
  for (const key of ['result', 'message', 'output', 'data']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.slice(0, 4000);
  }
  return '';
}
