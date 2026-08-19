import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
const ICON_ROOT = '/7dtd-item-icons';

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(name)) return new NextResponse(null, { status: 404 });
  try {
    const data = await fs.readFile(path.join(ICON_ROOT, `${name}.png`));
    return new NextResponse(data, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400, immutable' } });
  } catch {
    return new NextResponse(null, { status: 404, headers: { 'cache-control': 'public, max-age=300' } });
  }
}
