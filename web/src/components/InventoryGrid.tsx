'use client';

export type InventoryGridItem = { slot: string; count?: number; name: string };

export function InventoryGrid({ sections }: { sections: Array<[string, InventoryGridItem[] | undefined]> }) {
  return <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
    {sections.map(([title, items]) => items && items.length > 0 && <div key={title}>
      <strong style={{ color: '#cbd5e1' }}>{title}</strong>
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {items.map((item, index) => <div key={`${title}-${item.slot}-${index}`} title={`${item.name} · slot ${item.slot}`} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px', borderRadius: 7, background: 'rgba(15,23,42,.65)', border: '1px solid rgba(100,116,139,.25)' }}>
          <img src={`/item-icon/${encodeURIComponent(item.name)}`} alt="" width={42} height={42} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} style={{ objectFit: 'contain', imageRendering: 'auto' }} />
          <span style={{ color: '#e2e8f0', fontSize: 13, overflowWrap: 'anywhere' }}>{item.count ? `${item.count} × ` : ''}{item.name}</span>
        </div>)}
      </div>
    </div>)}
  </div>;
}
