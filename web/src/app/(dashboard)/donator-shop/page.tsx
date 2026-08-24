'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, ShopItem } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import '../../../lib/shop-ui.css';
import { ShopDescription, ShopImage } from '../../../lib/shop-copy';
import { SHOP_SORT_OPTIONS, sortShopItems, type ShopSort } from '../../../lib/shop-player';

const card: CSSProperties = { background: '#111118', borderRadius: 10, padding: '1.5rem', border: '1px solid #1e1e2a', marginBottom: '1rem' };
const inputStyle: CSSProperties = { padding: '0.55rem 0.875rem', borderRadius: 7, border: '1px solid #252532', fontSize: '0.875rem', background: '#0d0d14', color: '#f1f5f9', width: '100%', outline: 'none' };
const btnPrimary: CSSProperties = { padding: '0.5rem 1.125rem', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 };
const labelStyle: CSSProperties = { display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.3rem', fontWeight: 500 };

type JobResult = { data?: { items?: string[] }; errorMessage?: string };
type CatalogResponse = { items?: string[]; jobRunId?: string; cached?: boolean; count?: number };

type GrantDraft = { name: string; quantity: number; quality: number | null };
const emptyGrant = (): GrantDraft => ({ name: '', quantity: 1, quality: null });

function grantsFromItem(item: Pick<ShopItem, 'grantItems' | 'grantItemName' | 'grantQuantity' | 'grantQuality'>): GrantDraft[] {
  if (item.grantItems?.length) return item.grantItems.map((row) => ({ name: row.name, quantity: row.quantity || 1, quality: row.quality ?? null }));
  if (item.grantItemName) return [{ name: item.grantItemName, quantity: item.grantQuantity || 1, quality: item.grantQuality ?? null }];
  return [];
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function DonatorShopPage() {
  const orgId = getStoredOrgId();
  const [items, setItems] = useState<ShopItem[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('10.00');
  const [grants, setGrants] = useState<GrantDraft[]>([]);
  const [chatColor, setChatColor] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editImage, setEditImage] = useState<File | null>(null);
  const [sort, setSort] = useState<ShopSort>('featured');
  const [catalog, setCatalog] = useState<string[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogSource, setCatalogSource] = useState('');

  const sortedItems = useMemo(() => sortShopItems(items, sort), [items, sort]);

  const waitForJob = useCallback(async (runId: string) => {
    for (let i = 0; i < 240; i++) {
      const run = await api.get<{ status: string; result: JobResult | null } | null>(`/api/orgs/${orgId}/jobs/runs/${runId}`);
      if (run?.status === 'failed') throw new Error(run.result?.errorMessage || 'Item catalog job failed');
      if (run?.status === 'success') return (run.result || {}) as JobResult;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Item catalog timed out');
  }, [orgId]);

  const mergeCatalog = useCallback((...lists: Array<string[] | undefined>) => {
    const names = new Set<string>();
    for (const list of lists) {
      for (const name of list || []) {
        const trimmed = String(name || '').trim();
        if (trimmed) names.add(trimmed);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, []);

  const loadIconDirectory = useCallback(async () => {
    const response = await fetch('/api/item-icons', { cache: 'no-store' });
    if (!response.ok) return [] as string[];
    const body = await response.json() as { items?: string[] };
    return Array.isArray(body.items) ? body.items : [];
  }, []);

  const loadCatalog = useCallback(async (refresh = false) => {
    if (!orgId) return;
    setCatalogBusy(true);
    try {
      const icons = await loadIconDirectory();
      let gameItems: string[] = [];
      try {
        const response = await api.get<CatalogResponse>(`/api/orgs/${orgId}/shop-items/game-items${refresh ? '?refresh=1' : ''}`);
        if (response.jobRunId) {
          const result = await waitForJob(response.jobRunId);
          gameItems = result.data?.items || [];
        } else {
          gameItems = response.items || [];
        }
      } catch {
        // Icon directory alone is enough for autocomplete; game scan is enrichment.
      }
      const merged = mergeCatalog(icons, gameItems);
      setCatalog(merged);
      setCatalogSource(
        icons.length && gameItems.length
          ? `ItemIcons + items.xml (${merged.length.toLocaleString()})`
          : icons.length
            ? `ItemIcons directory (${merged.length.toLocaleString()})`
            : gameItems.length
              ? `items.xml (${merged.length.toLocaleString()})`
              : '',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load game items');
    } finally {
      setCatalogBusy(false);
    }
  }, [orgId, waitForJob, loadIconDirectory, mergeCatalog]);

  async function load() {
    if (!orgId) return;
    const rows = await api.get<ShopItem[]>(`/api/orgs/${orgId}/shop-items`);
    setItems(rows);
    const next: Record<string, string> = {};
    await Promise.all(rows.filter((row) => row.hasImage).map(async (row) => {
      try {
        const blob = await api.blob(`/api/orgs/${orgId}/shop-items/${row.id}/image`);
        next[row.id] = URL.createObjectURL(blob);
      } catch {
        return;
      }
    }));
    setPreviews((current) => {
      Object.values(current).forEach((url) => URL.revokeObjectURL(url));
      return next;
    });
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load shop items'));
    loadCatalog(true).catch((e) => setError(e instanceof Error ? e.message : 'Could not load game items'));
    return () => { /* revoke happens on next load */ };
  }, [orgId]);

  function formData(fields: Record<string, string>, file: File | null) {
    const body = new FormData();
    Object.entries(fields).forEach(([key, value]) => body.append(key, value));
    if (file) body.append('image', file, file.name);
    return body;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !image) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api.upload(`/api/orgs/${orgId}/shop-items`, formData({
        name, description, price, active: 'true',
        grantItems: JSON.stringify(grants.filter((row) => row.name.trim())),
        chatColor,
      }, image));
      setName(''); setDescription(''); setPrice('10.00'); setGrants([]); setChatColor(''); setImage(null);
      setMessage('Shop item created.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create item');
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(item: ShopItem) {
    if (!orgId) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api.upload(`/api/orgs/${orgId}/shop-items/${item.id}`, formData({
        name: item.name,
        description: item.description,
        price: (item.priceCents / 100).toFixed(2),
        active: String(item.active),
        grantItems: JSON.stringify((item.grantItems || grantsFromItem(item)).filter((row) => row.name.trim())),
        chatColor: item.chatColor || '',
      }, editImage), 'PATCH');
      setEditing(null); setEditImage(null);
      setMessage('Shop item updated.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update item');
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: ShopItem) {
    if (!orgId || !confirm(`Remove ${item.name} from the donator shop?`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api.delete(`/api/orgs/${orgId}/shop-items/${item.id}`);
      setMessage('Shop item removed.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove item');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>Donator Shop</h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>Create supporter packages for the player portal. Donations may include optional In-Game Gifts (thank-you `giveplus` items and donor chat color) — not a sale of in-game items. Pictures are shown in full (not cropped). Descriptions support **bold** and * bullet lines.</p>
      </div>
      {error && <p style={{ color: '#f87171', fontSize: '.875rem' }}>{error}</p>}
      {message && <p style={{ color: '#4ade80', fontSize: '.875rem' }}>{message}</p>}

      <div style={card}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#f1f5f9' }}>New item</h2>
        <form onSubmit={create} style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
          <div><label style={labelStyle}>Name</label><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} style={inputStyle} /></div>
          <div><label style={labelStyle}>Description (**bold** and * bullets)</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={6} style={{ ...inputStyle, resize: 'vertical' }} /></div>
          <div><label style={labelStyle}>Price (USD)</label><input type="number" min="1" max="500" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required style={inputStyle} /></div>
          <div>
            <label style={labelStyle}>In-Game Gifts (optional thank-you giveplus from items/blocks)</label>
            <GrantList value={grants} onChange={setGrants} catalog={catalog} loading={catalogBusy} sourceLabel={catalogSource} onRefresh={() => void loadCatalog(true)} />
          </div>
          <div><label style={labelStyle}>Donor chat color (optional hex, e.g. FF00FF)</label><input value={chatColor} onChange={(e) => setChatColor(e.target.value)} maxLength={7} placeholder="FF00FF" style={inputStyle} /></div>
          <div><label style={labelStyle}>Picture (JPEG, PNG, or WebP, 2 MB max). Resized automatically for the shop (full quality, WebP).</label><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setImage(e.target.files?.[0] || null)} required /></div>
          <button disabled={busy || !name.trim() || !image} style={btnPrimary}>{busy ? 'Saving…' : 'Add item'}</button>
        </form>
      </div>

      {sortedItems.length > 0 && (
        <div className="shop-sort-bar" style={{ marginBottom: '1rem' }}>
          <span className="shop-sort-label">{sortedItems.length} item{sortedItems.length === 1 ? '' : 's'}</span>
          <label className="shop-sort-label">
            Sort{' '}
            <select className="shop-sort-select" value={sort} onChange={(e) => setSort(e.target.value as ShopSort)}>
              {SHOP_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {sortedItems.map((item) => {
        const isEditing = editing === item.id;
        return (
          <div key={item.id} style={card}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'start' }}>
              {previews[item.id] ? <ShopImage src={previews[item.id]} alt={item.name} compact /> : <div style={{ width: 180, height: 120, borderRadius: 8, background: '#0d0d14', color: '#64748b', display: 'grid', placeItems: 'center', fontSize: 12 }}>No picture</div>}
              <div style={{ flex: 1, minWidth: 240 }}>
                {isEditing ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <input value={item.name} onChange={(e) => setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, name: e.target.value } : row))} style={inputStyle} />
                    <textarea value={item.description} onChange={(e) => setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, description: e.target.value } : row))} rows={6} style={{ ...inputStyle, resize: 'vertical' }} />
                    <input type="number" min="1" max="500" step="0.01" value={(item.priceCents / 100).toFixed(2)} onChange={(e) => setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, priceCents: Math.round(Number(e.target.value) * 100) } : row))} style={inputStyle} />
                    <GrantList
                      value={item.grantItems?.length ? item.grantItems : grantsFromItem(item)}
                      onChange={(next) => setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, grantItems: next } : row))}
                      catalog={catalog}
                      loading={catalogBusy}
                      sourceLabel={catalogSource}
                      onRefresh={() => void loadCatalog(true)}
                    />
                    <input value={item.chatColor || ''} onChange={(e) => setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, chatColor: e.target.value } : row))} placeholder="FF00FF" style={inputStyle} />
                    <label style={{ color: '#94a3b8', fontSize: 13 }}><input type="checkbox" checked={item.active} onChange={(e) => setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, active: e.target.checked } : row))} /> Active in player shop</label>
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setEditImage(e.target.files?.[0] || null)} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button disabled={busy} onClick={() => void saveItem(item)} style={btnPrimary}>Save</button>
                      <button type="button" disabled={busy} onClick={() => { setEditing(null); setEditImage(null); void load(); }} style={{ ...btnPrimary, background: '#334155' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 style={{ margin: '0 0 8px', fontSize: '1.05rem', color: '#f1f5f9' }}>{item.name}</h2>
                    {item.description ? <ShopDescription text={item.description} muted /> : <p style={{ margin: '0 0 8px', color: '#64748b', fontSize: 13 }}>No description</p>}
                    <p style={{ margin: 0, color: '#c4b5fd' }}>{money(item.priceCents)} · {item.active ? 'Active' : 'Hidden'}</p>
                    {(grantsFromItem(item).length > 0 || item.chatColor) && (
                      <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: 13 }}>
                        {grantsFromItem(item).length ? `In-Game Gifts: ${grantsFromItem(item).map((row) => `${row.quantity}× ${row.name}${row.quality ? ` Q${row.quality}` : ''}`).join(', ')}` : 'No In-Game Gifts'}
                        {item.chatColor ? ` · chat #${item.chatColor}` : ''}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button disabled={busy} onClick={() => { setEditing(item.id); setEditImage(null); }} style={{ ...btnPrimary, background: '#334155' }}>Edit</button>
                      <button disabled={busy} onClick={() => void remove(item)} style={{ ...btnPrimary, background: '#991b1b' }}>Remove</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {items.length === 0 && <p style={{ color: '#64748b' }}>No shop items yet. Add a name, price, and picture above.</p>}
    </div>
  );
}

function GrantList({
  value,
  onChange,
  catalog,
  loading,
  sourceLabel,
  onRefresh,
}: {
  value: GrantDraft[];
  onChange: (value: GrantDraft[]) => void;
  catalog: string[];
  loading: boolean;
  sourceLabel: string;
  onRefresh: () => void;
}) {
  const rows = value.length ? value : [emptyGrant()];
  function update(index: number, patch: Partial<GrantDraft>) {
    const next = rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row);
    onChange(next.some((row) => row.name.trim()) || next.length > 1 ? next : []);
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((row, index) => (
        <div key={index} style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid #252532', borderRadius: 8 }}>
          <GrantItemPicker
            value={row.name}
            onChange={(name) => update(index, { name })}
            catalog={catalog}
            loading={loading}
            sourceLabel={sourceLabel}
            onRefresh={onRefresh}
            showReload={index === 0}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <div><label style={labelStyle}>Quantity</label><input type="number" min="1" max="9999" step="1" value={row.quantity} onChange={(e) => update(index, { quantity: Number(e.target.value) || 1 })} style={inputStyle} /></div>
            <div><label style={labelStyle}>Quality 1–6</label><input type="number" min="1" max="6" step="1" value={row.quality ?? ''} onChange={(e) => update(index, { quality: e.target.value === '' ? null : Number(e.target.value) })} style={inputStyle} /></div>
            <button type="button" onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))} style={{ ...btnPrimary, background: '#334155' }}>Remove</button>
          </div>
        </div>
      ))}
      {rows.length < 8 && (
        <button type="button" onClick={() => onChange([...rows, emptyGrant()])} style={{ ...btnPrimary, background: '#4338ca', justifySelf: 'start' }}>Add another item</button>
      )}
    </div>
  );
}

function rankCatalogMatches(catalog: string[], query: string) {
  const needle = query.trim().toLowerCase();
  // Catalog is already A–Z from load; avoid re-sorting 5k names on every keystroke.
  if (!needle) return catalog;
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const name of catalog) {
    const lower = name.toLowerCase();
    if (lower.startsWith(needle)) prefix.push(name);
    else if (lower.includes(needle)) contains.push(name);
  }
  return [...prefix, ...contains];
}

const CATALOG_PAGE = 100;

function GrantItemPicker({
  value,
  onChange,
  catalog,
  loading,
  sourceLabel,
  onRefresh,
  showReload = true,
}: {
  value: string;
  onChange: (value: string) => void;
  catalog: string[];
  loading: boolean;
  sourceLabel: string;
  onRefresh: () => void;
  showReload?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [visibleCount, setVisibleCount] = useState(CATALOG_PAGE);
  const listRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => rankCatalogMatches(catalog, value), [catalog, value]);
  const visible = matches.slice(0, visibleCount);
  const hasMore = visibleCount < matches.length;

  useEffect(() => {
    setHighlight(0);
    setVisibleCount(CATALOG_PAGE);
  }, [value, open, catalog]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function loadMore() {
    setVisibleCount((count) => Math.min(count + CATALOG_PAGE, matches.length));
  }

  function onListScroll(event: React.UIEvent<HTMLDivElement>) {
    const node = event.currentTarget;
    if (node.scrollTop + node.clientHeight >= node.scrollHeight - 48) loadMore();
  }

  function choose(name: string) {
    onChange(name);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) => {
        const next = Math.min(index + 1, Math.max(matches.length - 1, 0));
        if (next >= visibleCount - 5) loadMore();
        return next;
      });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter' && open && matches[highlight]) {
      event.preventDefault();
      choose(matches[highlight]);
      return;
    }
    if (event.key === 'Escape') setOpen(false);
  }

  return (
    <div style={{ position: 'relative' }}>
      <label style={labelStyle}>Item name</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            value={value}
            onChange={(e) => { onChange(e.target.value); setOpen(true); }}
            onFocus={() => {
              setOpen(true);
              if (!catalog.length && !loading) onRefresh();
            }}
            onClick={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 180)}
            onKeyDown={onKeyDown}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            placeholder={loading ? 'Loading item directory…' : catalog.length ? 'Click for A–Z list, or type to filter' : 'resourceWood'}
            aria-autocomplete="list"
            aria-expanded={open}
            style={{ ...inputStyle, paddingRight: 40 }}
          />
          <button
            type="button"
            aria-label="Show item names"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen((current) => !current);
              if (!catalog.length && !loading) onRefresh();
            }}
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              border: 0,
              background: 'transparent',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: 14,
              padding: '4px 6px',
            }}
          >
            ▾
          </button>
        </div>
        <button type="button" disabled={loading} onMouseDown={(e) => e.preventDefault()} onClick={onRefresh} style={{ ...btnPrimary, background: '#334155', whiteSpace: 'nowrap', display: showReload ? undefined : 'none' }}>
          {loading ? 'Reading…' : 'Reload'}
        </button>
      </div>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          onScroll={onListScroll}
          style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: showReload ? 88 : 0, marginTop: 4, maxHeight: 280, overflow: 'auto', background: '#0d0d14', border: '1px solid #303044', borderRadius: 7, boxShadow: '0 12px 28px rgba(0,0,0,.45)' }}
        >
          {!catalog.length && (
            <div style={{ padding: '0.65rem 0.75rem', color: '#94a3b8', fontSize: 13 }}>
              {loading ? 'Loading item names…' : 'No item directory loaded yet. Click Reload, or type a name.'}
            </div>
          )}
          {catalog.length > 0 && !value.trim() && (
            <div style={{ padding: '0.45rem 0.75rem', color: '#64748b', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid #252532' }}>
              A–Z · {catalog.length.toLocaleString()} names · scroll for more
            </div>
          )}
          {value.trim() !== '' && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose('')} style={optionStyle(false)}>Clear</button>
          )}
          {visible.map((name, index) => (
            <button
              key={name}
              type="button"
              role="option"
              data-active={index === highlight ? 'true' : 'false'}
              aria-selected={name === value}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => choose(name)}
              style={optionStyle(name === value || index === highlight)}
            >
              {name}
            </button>
          ))}
          {catalog.length > 0 && matches.length === 0 && (
            <div style={{ padding: '0.55rem 0.75rem', color: '#64748b', fontSize: 13 }}>No matching item names</div>
          )}
          {hasMore && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={loadMore}
              style={{ ...optionStyle(false), color: '#94a3b8', textAlign: 'center', borderTop: '1px solid #252532' }}
            >
              Showing {visible.length.toLocaleString()} of {matches.length.toLocaleString()} · load more
            </button>
          )}
          {!hasMore && matches.length > CATALOG_PAGE && (
            <div style={{ padding: '0.45rem 0.75rem', color: '#64748b', fontSize: 12, textAlign: 'center', borderTop: '1px solid #252532' }}>
              All {matches.length.toLocaleString()} matches
            </div>
          )}
        </div>
      )}
      <small style={{ display: showReload ? 'block' : 'none', marginTop: 6, color: '#64748b' }}>
        {loading
          ? 'Reading ItemIcons and game item lists…'
          : sourceLabel
            ? `${sourceLabel}. Click the empty box for the full alphabetical list.`
            : 'Catalog unavailable — you can still type a name'}
      </small>
    </div>
  );
}

function optionStyle(active: boolean): CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: active ? '#1f1b3a' : 'transparent',
    color: '#e2e8f0',
    border: 0,
    padding: '0.45rem 0.75rem',
    cursor: 'pointer',
    fontFamily: 'ui-monospace, monospace',
    fontSize: 13,
  };
}
