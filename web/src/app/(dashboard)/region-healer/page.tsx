'use client';
import { useEffect, useState } from 'react';
import { api, Job, ServerInstance } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';

export default function RegionHealerPage() {
  const orgId = getStoredOrgId();
  const [server, setServer] = useState<ServerInstance|null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!orgId) return;
    const [servers, recent] = await Promise.all([
      api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`),
      api.get<Job[]>(`/api/orgs/${orgId}/jobs?limit=25`),
    ]);
    setServer(servers.find(s=>s.gameType==='7dtd') || servers[0] || null);
    setJobs(recent.filter(j=>j.type.startsWith('REGION_HEALER_')));
  }
  useEffect(()=>{ refresh().catch(e=>setMessage(e.message)); const t=setInterval(()=>refresh().catch(()=>{}),5000); return()=>clearInterval(t); },[orgId]);

  async function control(type:'REGION_HEALER_START'|'REGION_HEALER_STOP') {
    if (!orgId || !server) return;
    setBusy(true); setMessage('');
    try {
      await api.post(`/api/orgs/${orgId}/jobs`, { serverInstanceId: server.id, type, payload: {} });
      setMessage(type.endsWith('START') ? 'Start requested.' : 'Stop requested.');
      setTimeout(()=>refresh().catch(()=>{}),2000);
    } catch(e) { setMessage(e instanceof Error ? e.message : 'Request failed'); }
    finally { setBusy(false); }
  }

  const latest = jobs[0];
  const card={background:'#111118',border:'1px solid #1e1e2a',borderRadius:10,padding:'1.25rem'};
  return <div>
    <h1 style={{margin:'0 0 .25rem',color:'#f1f5f9',fontSize:'1.5rem'}}>Region Healer</h1>
    <p style={{color:'#64748b',margin:'0 0 1.5rem'}}>Detects incorrect region headers, quarantines corrupt files, restores snapshots, then restarts 7DTD.</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1rem',marginBottom:'1rem'}}>
      <div style={card}><small style={{color:'#64748b'}}>SERVICE</small><div style={{color:'#4ade80',fontSize:'1.2rem',marginTop:6}}>Enabled at boot</div></div>
      <div style={card}><small style={{color:'#64748b'}}>BACKUPS</small><div style={{color:'#e2e8f0',fontSize:'1.2rem',marginTop:6}}>Every 60 minutes</div></div>
      <div style={card}><small style={{color:'#64748b'}}>RETENTION</small><div style={{color:'#e2e8f0',fontSize:'1.2rem',marginTop:6}}>24 snapshots</div></div>
    </div>
    <div style={{...card,marginBottom:'1rem'}}>
      <div style={{color:'#94a3b8',marginBottom:10}}>World: <code>/opt/7dtd/userdata/Saves/Rotterdam/Builder</code></div>
      <div style={{color:'#94a3b8',marginBottom:16}}>Latest control: {latest ? `${latest.type} — ${latest.latestRun?.status || 'pending'}` : 'service started during installation'}</div>
      <div style={{display:'flex',gap:8}}>
        <button disabled={busy||!server} onClick={()=>control('REGION_HEALER_START')} style={{padding:'.6rem 1rem',border:0,borderRadius:6,background:'#16a34a',color:'white'}}>Start healer</button>
        <button disabled={busy||!server} onClick={()=>control('REGION_HEALER_STOP')} style={{padding:'.6rem 1rem',border:0,borderRadius:6,background:'#991b1b',color:'white'}}>Stop healer</button>
      </div>
      {message&&<div style={{color:'#fbbf24',marginTop:12}}>{message}</div>}
    </div>
    <div style={card}><strong style={{color:'#e2e8f0'}}>Safety</strong><p style={{color:'#94a3b8',marginBottom:0}}>Filename/path validation, restore lock, corrupt-file quarantine, graceful stop, snapshot escalation, and automatic restart enabled.</p></div>
  </div>;
}
