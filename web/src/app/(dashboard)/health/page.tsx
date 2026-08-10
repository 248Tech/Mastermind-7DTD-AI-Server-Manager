'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, HealthDashboard, HealthSample } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';

function average(values:number[]) { return values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0; }
function Sparkline({samples,field,color,max}:{samples:HealthSample[];field:'cpuPercent'|'latencyMs'|'ramUsedMb';color:string;max:number}) {
  const recent=samples.slice(-80); if(recent.length<2)return <div style={{height:55,color:'#475569'}}>Collecting samples…</div>;
  const points=recent.map((s,i)=>`${(i/(recent.length-1))*100},${50-Math.min(50,(Number(s[field])/Math.max(max,1))*50)}`).join(' ');
  return <svg viewBox="0 0 100 50" preserveAspectRatio="none" style={{width:'100%',height:55}}><polyline points={points} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke"/></svg>;
}

export default function HealthPage(){
  const orgId=getStoredOrgId(); const [data,setData]=useState<HealthDashboard>({hosts:[],samples:[],intervalSec:10});
  const [error,setError]=useState(''); const [windowMinutes,setWindowMinutes]=useState(60);
  const load=useCallback(async()=>{if(!orgId)return;try{setData(await api.get<HealthDashboard>(`/api/orgs/${orgId}/health?minutes=${windowMinutes}`));setError('');}catch(e){setError(e instanceof Error?e.message:'Health request failed');}},[orgId,windowMinutes]);
  useEffect(()=>{load();const timer=setInterval(load,5000);return()=>clearInterval(timer);},[load]);
  const latest=data.samples[data.samples.length-1];
  const stats=useMemo(()=>({cpu:average(data.samples.map(s=>s.cpuPercent)),latency:average(data.samples.filter(s=>s.gameReachable).map(s=>s.latencyMs)),ram:average(data.samples.map(s=>s.ramUsedMb)),ramTotal:latest?.ramTotalMb||0}),[data.samples,latest]);
  const card={background:'#111118',border:'1px solid #1e1e2a',borderRadius:10,padding:'1.1rem'};
  return <div>
    <div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.25rem'}}><div><h1 style={{margin:0,color:'#f1f5f9',fontSize:'1.5rem'}}>Server Health</h1><p style={{color:'#64748b',margin:'.25rem 0 0'}}>Live checks and historical resource usage</p></div><div style={{display:'flex',gap:8}}>
      <select value={windowMinutes} onChange={e=>setWindowMinutes(Number(e.target.value))} style={{background:'#111118',color:'#e2e8f0',border:'1px solid #252532',borderRadius:6,padding:'.5rem'}}><option value={60}>Last hour</option><option value={360}>6 hours</option><option value={1440}>24 hours</option></select>
      <select value={data.intervalSec} onChange={async e=>{const intervalSec=Number(e.target.value);setData(d=>({...d,intervalSec}));try{await api.post(`/api/orgs/${orgId}/health/settings`,{intervalSec});setError('');}catch(err){setError(err instanceof Error?err.message:'Save failed');}}} style={{background:'#111118',color:'#e2e8f0',border:'1px solid #252532',borderRadius:6,padding:'.5rem'}}><option value={5}>Every 5s</option><option value={10}>Every 10s</option><option value={30}>Every 30s</option><option value={60}>Every 60s</option></select>
    </div></div>
    {error&&<div style={{color:'#f87171',marginBottom:12}}>{error}</div>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1rem',marginBottom:'1rem'}}>
      <div style={card}><small style={{color:'#64748b'}}>AVERAGE CPU</small><div style={{fontSize:'1.7rem',color:'#38bdf8'}}>{stats.cpu.toFixed(1)}%</div><Sparkline samples={data.samples} field="cpuPercent" color="#38bdf8" max={100}/></div>
      <div style={card}><small style={{color:'#64748b'}}>AVERAGE RAM</small><div style={{fontSize:'1.7rem',color:'#a78bfa'}}>{(stats.ram/1024).toFixed(1)} / {(stats.ramTotal/1024).toFixed(1)} GiB</div><Sparkline samples={data.samples} field="ramUsedMb" color="#a78bfa" max={stats.ramTotal}/></div>
      <div style={card}><small style={{color:'#64748b'}}>AVERAGE GAME CHECK LATENCY</small><div style={{fontSize:'1.7rem',color:'#4ade80'}}>{stats.latency.toFixed(2)} ms</div><Sparkline samples={data.samples} field="latencyMs" color="#4ade80" max={Math.max(10,...data.samples.map(s=>s.latencyMs))}/></div>
    </div>
    <div style={card}><h2 style={{color:'#f1f5f9',fontSize:'1rem',margin:'0 0 .75rem'}}>Health checks</h2>{data.hosts.map(h=>{const m=h.lastMetrics||{};const heartbeat=h.lastHeartbeatAt?Date.now()-new Date(h.lastHeartbeatAt).getTime()<30000:false;return <div key={h.id} style={{display:'grid',gridTemplateColumns:'2fr repeat(5,1fr)',gap:12,padding:'.7rem',borderTop:'1px solid #1e1e2a',color:'#cbd5e1'}}><strong>{h.name}</strong><span style={{color:heartbeat?'#4ade80':'#f87171'}}>{heartbeat?'Heartbeat OK':'Heartbeat stale'}</span><span style={{color:m.gameReachable?'#4ade80':'#f87171'}}>{m.gameReachable?'Game port OK':'Game port failed'}</span><span>CPU {(m.cpu||0).toFixed(1)}%</span><span>RAM {((m.ramUsedMb||0)/1024).toFixed(1)} GiB</span><span>{(m.latencyMs||0).toFixed(2)} ms</span></div>})}</div>
  </div>;
}
