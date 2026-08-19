export type InventoryItem = { slot: string; count?: number; name: string };
export type InventorySnapshot = {
  bag: InventoryItem[];
  belt: InventoryItem[];
  equipment: InventoryItem[];
  other: InventoryItem[];
};

const SECTION = /^(bag|bagpack|backpack|belt|toolbelt|equipment|worn|other)\b/i;
const ITEM = /^(?:slot\s*)?([A-Za-z0-9_.:-]+)\s*[.)::-]\s*(\d+)\s*\*\s*(.+)$/i;
const ITEM_ALT = /^(\d+)\s*\*\s+(.+)$/;
// ServerTools Player_Logs uses the human-readable form `Slot 2: 11764 * item`.
// Keep this before the generic item expression so the slot number and stack
// quantity are not mistaken for an item name (which previously defaulted to 1).
const SLOT_STACK = /^slot\s*(\d+)\s*:\s*(\d+)\s*\*\s*(.+)$/i;
const ITEM_EQUIPMENT = /^(?:slot\s*)?([A-Za-z0-9_.:-]+)\s*:\s*(.+)$/i;
const EMPTY_SLOT_EQUIPMENT = /^slot\s*:\s*(.+)$/i;
const TRACKER_ITEM = /\blocation=([^,\s]+).*?slot=([^,\s]+).*?item=([^,]+).*?qnty=(\d+)/i;
const SERVERTOOLS_ITEM = /^(inventory|bag|equipment)\s+slot:\s*['\"]?([^'\"\s]+)['\"]?\s+itemname:\s*['\"]([^'\"]+)['\"]/i;
const EQUIPMENT_SLOT = /^(?:head|eyes|face|armor|jacket|shirt|legarmor|pants|boots|gloves|hands|chest|legs|feet)$/i;

function sectionOf(line: string): keyof InventorySnapshot | null {
  const match = SECTION.exec(line.replace(/[:\s]+$/g, '').replace(/\s+of player\b.*/i, ''));
  if (!match) return null;
  const key = match[1].toLowerCase();
  if (key === 'bag' || key === 'bagpack' || key === 'backpack') return 'bag';
  if (key === 'belt' || key === 'toolbelt') return 'belt';
  if (key === 'equipment' || key === 'worn') return 'equipment';
  return 'other';
}

function parseItem(line: string): InventoryItem | null {
  const trimmed = line.trim();
  const slotStack = SLOT_STACK.exec(trimmed);
  if (slotStack) {
    const count = Number(slotStack[2]);
    const name = cleanItemName(slotStack[3]);
    if (!name || !Number.isFinite(count) || count < 1) return null;
    return { slot: slotStack[1].slice(0, 24), count: Math.min(count, 99_999), name };
  }
  const serverTools = SERVERTOOLS_ITEM.exec(trimmed);
  if (serverTools) return { slot: serverTools[2].slice(0, 24), name: cleanItemName(serverTools[3]) };
  const tracker = TRACKER_ITEM.exec(trimmed);
  if (tracker) return { slot: tracker[2].slice(0, 24), count: Math.min(Math.max(1, Number(tracker[4])), 99_999), name: cleanItemName(tracker[3]) };
  const primary = ITEM.exec(trimmed);
  if (primary) {
    const count = Number(primary[2]);
    const name = cleanItemName(primary[3]);
    if (!name || !Number.isFinite(count) || count < 1) return null;
    return { slot: primary[1].slice(0, 24), count: Math.min(count, 99_999), name };
  }
  const alt = ITEM_ALT.exec(trimmed);
  if (!alt) {
    const equipment = ITEM_EQUIPMENT.exec(trimmed);
    const emptySlot = EMPTY_SLOT_EQUIPMENT.exec(trimmed);
    if (!equipment && !emptySlot) return null;
    if (equipment && !EQUIPMENT_SLOT.test(equipment[1])) return null;
    const name = cleanItemName(equipment ? equipment[2] : emptySlot![1]);
    return name ? { slot: equipment ? equipment[1].slice(0, 24) : '', count: 1, name } : null;
  }
  const count = Number(alt[1]);
  const name = cleanItemName(alt[2]);
  if (!name || !Number.isFinite(count) || count < 1) return null;
  return { slot: '?', count: Math.min(count, 99_999), name };
}

function cleanItemName(value: string) {
  return value.replace(/\s+\(.*\)$/, '').replace(/\s+-\s+quality:\s*-?\d+.*$/i, '').trim().slice(0, 80);
}

export function parseInventoryOutput(output: string): InventorySnapshot {
  const snapshot: InventorySnapshot = { bag: [], belt: [], equipment: [], other: [] };
  let current: keyof InventorySnapshot = 'other';
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const item = parseItem(line);
    const section = sectionOf(line);
    if (section && !item) {
      current = section;
      continue;
    }
    if (!item) continue;
    const tracker = TRACKER_ITEM.exec(line);
    const serverTools = SERVERTOOLS_ITEM.exec(line);
    const trackerLocation = tracker?.[1].toLowerCase();
    const serverToolsLocation = serverTools?.[1].toLowerCase();
    const bucketName: keyof InventorySnapshot = serverToolsLocation === 'inventory' || trackerLocation === 'belt' || trackerLocation === 'toolbelt'
      ? 'belt'
      : serverToolsLocation === 'bag' || trackerLocation === 'backpack' || trackerLocation === 'bag' || trackerLocation === 'bagpack'
        ? 'bag'
        : serverToolsLocation === 'equipment' || trackerLocation === 'equipment' || trackerLocation === 'worn' ? 'equipment' : current;
    const bucket = snapshot[bucketName];
    if (bucket.length >= 80) continue;
    bucket.push(item);
  }
  return snapshot;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function jsonItems(value: unknown): Array<{ row: unknown; slot: string }> {
  if (Array.isArray(value)) return value.map((row, index) => ({ row, slot: String(index) }));
  const record = asRecord(value);
  if (!record) return [];
  if (Array.isArray(record.items)) return record.items.map((row, index) => ({ row, slot: String(index) }));
  if (Array.isArray(record.Items)) return record.Items.map((row, index) => ({ row, slot: String(index) }));
  return Object.entries(record)
    .filter(([key]) => !/^(count|total|length)$/i.test(key))
    .map(([slot, row]) => ({ row, slot }));
}

function jsonItemName(row: unknown): string {
  if (typeof row === 'string') return cleanItemName(row);
  const record = asRecord(row);
  if (!record) return '';
  const nested = asRecord(record.item) || asRecord(record.Item);
  return cleanItemName(
    [record.name, record.itemname, record.itemName, record.Name, nested?.name, nested?.itemname]
      .find((value) => typeof value === 'string' && value.trim()) as string || '',
  );
}

function jsonItemCount(row: unknown): number | undefined {
  const record = asRecord(row);
  if (!record) return undefined;
  const nested = asRecord(record.item) || asRecord(record.Item);
  // Allocs/WebMap versions have used each of these names for a stack size.
  // Treat zero as an empty slot, but preserve every positive quantity.
  for (const value of [
    record.count, record.Count, record.qnty, record.quantity, record.Quantity,
    record.amount, record.Amount, record.stack, record.Stack, record.stackSize,
    record.StackSize, record.stackcount, record.StackCount, nested?.count,
    nested?.quantity, nested?.stack, nested?.stackSize,
  ]) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(n)) return Math.min(Math.max(0, n), 99_999);
  }
  return undefined;
}

function isEmptyItemName(name: string) {
  return !name || /^(air|empty|none|null)$/i.test(name);
}

export function parseAllocsInventoryJson(json: unknown): InventorySnapshot {
  const snapshot: InventorySnapshot = { bag: [], belt: [], equipment: [], other: [] };
  const root = asRecord(json) || {};
  const inventory = asRecord(root.inventory) || asRecord(root.data) || root;
  const buckets: Array<[keyof InventorySnapshot, unknown]> = [
    ['bag', inventory.bag ?? inventory.Bag ?? inventory.bagpack ?? inventory.backpack],
    ['belt', inventory.belt ?? inventory.Belt ?? inventory.toolbelt],
    ['equipment', inventory.equipment ?? inventory.Equipment ?? inventory.worn],
  ];
  for (const [bucketName, value] of buckets) {
    const bucket = snapshot[bucketName];
    for (const entry of jsonItems(value)) {
      if (bucket.length >= 80) break;
      const name = jsonItemName(entry.row);
      if (isEmptyItemName(name) || entry.row == null) continue;
      const count = jsonItemCount(entry.row);
      if (count === 0) continue;
      const record = asRecord(entry.row);
      const slot = String(record?.slot ?? record?.Slot ?? entry.slot).slice(0, 24);
      bucket.push({ slot, name, count: count && count > 0 ? count : 1 });
    }
  }
  return snapshot;
}

export function parseLpPosition(line: string): { x: number; y: number; z: number } | null {
  const match = /\bpos=\((-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\)/i.exec(line);
  if (!match) return null;
  const x = Number(match[1]), y = Number(match[2]), z = Number(match[3]);
  if (![x, y, z].every(Number.isFinite)) return null;
  if (Math.abs(x) > 1_000_000 || Math.abs(y) > 10_000 || Math.abs(z) > 1_000_000) return null;
  return { x, y, z };
}
