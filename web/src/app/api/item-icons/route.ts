import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const ICON_ROOT = '/7dtd-item-icons';
const NAME_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/;
const CACHE_MS = 10 * 60 * 1000;

let cached: { at: number; items: string[] } | null = null;

async function listIconNames(): Promise<string[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.items;
  const entries = await fs.readdir(ICON_ROOT, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map((entry) => entry.name.slice(0, -4))
    .filter((name) => NAME_RE.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  cached = { at: Date.now(), items: names };
  return names;
}

export async function GET() {
  try {
    const items = await listIconNames();
    return NextResponse.json(
      { items, count: items.length, source: 'item-icons' },
      { headers: { 'cache-control': 'private, max-age=300' } },
    );
  } catch {
    return NextResponse.json(
      { items: [], count: 0, message: 'Item icon directory unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
