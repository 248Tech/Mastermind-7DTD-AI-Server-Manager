'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, Job, ServerInstance } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';

type HealerSettings={backupTime:string;timezone:string;retentionCount:number;snapshotCount:number;active:boolean};
type JobResult={data?:HealerSettings;errorMessage?:string};

export default function RegionHealerPage() {
  const orgId=getStoredOrgId();
  const [server,setServer]=useState<ServerInstance|null>(null),[jobs,setJobs]=useState<Job[]>([]);
  const [settings,setSettings]=useState<HealerSettings|null>(null),[backupTime,setBackupTime]=useState('03:00');
  const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);

  const waitForJob=useCallback(async(runId:string)=>{for(let i=0;i<120;i++){await new Promise(resolve=>setTimeout(resolve,1000));const run=await api.get<{status:string;result:JobResult|null}|null>(`/api/orgs/${orgId}/jobs/runs/${runId}`);if(run?.status==='failed')throw new Error(run.result?.errorMessage||'Region Healer operation failed');if(run?.status==='success')return run.result?.data;}throw new Error('Region Healer did not respond within two minutes');},[orgId]);
  const run=useCallback(async(type:string,payload:Record<string,unknown>={})=>{if(!orgId||!server)throw new Error('No 7DTD server is connected');const queued=await api.post<{jobRunId:string}>(`/api/orgs/${orgId}/jobs`,{serverInstanceId:server.id,type,payload});return waitForJob(queued.jobRunId);},[orgId,server,waitForJob]);
  const refreshJobs=useCallback(async()=>{if(!orgId)return;const recent=await api.get<Job[]>(`/api/orgs/${orgId}/jobs?limit=25`);setJobs(recent.filter(job=>job.type.startsWith('REGION_HEALER_')));},[orgId]);
  const loadSettings=useCallback(async()=>{if(!server)return;const value=await run('REGION_HEALER_STATUS');if(value){setSettings(value);setBackupTime(value.backupTime);}},[server,run]);

  useEffect(()=>{if(!orgId)return;api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`).then(rows=>setServer(rows.find(item=>item.gameType==='7dtd')||rows[0]||null)).catch(e=>setError(e instanceof Error?e.message:'Could not load server'));},[orgId]);
  useEffect(()=>{if(!server)return;void loadSettings().catch(e=>setError(e instanceof Error?e.message:'Could not read Region Healer settings'));void refreshJobs();const timer=setInterval(()=>void refreshJobs().catch(()=>undefined),5000);return()=>clearInterval(timer);},[server,loadSettings,refreshJobs]);

  async function control(type:'REGION_HEALER_START'|'REGION_HEALER_STOP') {setBusy(true);setError('');setMessage(type.endsWith('START')?'Starting Region Healer…':'Stopping Region Healer…');try{await run(type);await loadSettings();await refreshJobs();setMessage(type.endsWith('START')?'Region Healer started.':'Region Healer stopped.');}catch(e){setError(e instanceof Error?e.message:'Request failed');setMessage('');}finally{setBusy(false);}}
  async function savePolicy(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');setMessage('Saving daily backup time and pruning old Region Healer snapshots…');try{const value=await run('REGION_HEALER_CONFIGURE',{backup_time:backupTime});if(value)setSettings(value);await refreshJobs();setMessage(`Region Healer will keep one backup, taken daily at ${backupTime} ${value?.timezone||settings?.timezone||'America/New_York'}.`);}catch(e){setError(e instanceof Error?e.message:'Could not save backup policy');setMessage('');}finally{setBusy(false);}}

  const latest=jobs[0],card:React.CSSProperties={background:'#111118',border:'1px solid #1e1e2a',borderRadius:10,padding:'1.25rem'};
  const button=(background:string):React.CSSProperties=>({padding:'.6rem 1rem',border:0,borderRadius:6,background,color:'white',cursor:busy?'wait':'pointer',opacity:busy ? 0.65 : 1});
  return <div>
    <h1 style={{margin:'0 0 .25rem',color:'#f1f5f9',fontSize:'1.5rem'}}>Region Healer</h1>
    <p style={{color:'#64748b',margin:'0 0 1.5rem'}}>Detects incorrect region headers, quarantines corrupt files, restores the latest known-good region snapshot, then restarts 7DTD.</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:'1rem',marginBottom:'1rem'}}>
      <div style={card}><small style={{color:'#64748b'}}>SERVICE</small><div style={{color:settings?.active?'#4ade80':'#f87171',fontSize:'1.2rem',marginTop:6}}>{settings?.active?'Running':'Stopped'}</div></div>
      <div style={card}><small style={{color:'#64748b'}}>BACKUP TIME</small><div style={{color:'#e2e8f0',fontSize:'1.2rem',marginTop:6}}>{settings?.backupTime||'—'} <small style={{fontSize:'.7rem',color:'#64748b'}}>{settings?.timezone||''}</small></div></div>
      <div style={card}><small style={{color:'#64748b'}}>RETENTION</small><div style={{color:'#e2e8f0',fontSize:'1.2rem',marginTop:6}}>1 snapshot</div></div>
    </div>
    <form onSubmit={savePolicy} style={{...card,marginBottom:'1rem',display:'flex',alignItems:'end',gap:12,flexWrap:'wrap'}}>
      <label style={{display:'flex',flexDirection:'column',gap:6,color:'#94a3b8',fontSize:'.8rem'}}>Daily backup time<input type="time" required value={backupTime} onChange={event=>setBackupTime(event.target.value)} style={{background:'#08080c',color:'#e2e8f0',border:'1px solid #252532',borderRadius:6,padding:'.6rem'}}/></label>
      <div style={{color:'#64748b',fontSize:'.78rem',paddingBottom:'.6rem'}}>Time zone: America/New_York. Saving immediately removes older Region Healer snapshots; full-world backups are unaffected.</div>
      <button disabled={busy||!server} style={button('#4f46e5')}>Save backup policy</button>
    </form>
    <div style={{...card,marginBottom:'1rem'}}>
      <div style={{color:'#94a3b8',marginBottom:10}}>World: <code>/opt/7dtd/userdata/Saves/Rotterdam/Builder</code></div>
      <div style={{color:'#94a3b8',marginBottom:16}}>Stored Region Healer snapshots: {settings?.snapshotCount??'—'} · Latest control: {latest?`${latest.type} — ${latest.latestRun?.status||'pending'}`:'none'}</div>
      <div style={{display:'flex',gap:8}}><button disabled={busy||!server||settings?.active===true} onClick={()=>void control('REGION_HEALER_START')} style={button('#16a34a')}>Start healer</button><button disabled={busy||!server||settings?.active===false} onClick={()=>void control('REGION_HEALER_STOP')} style={button('#991b1b')}>Stop healer</button></div>
      {error&&<div style={{color:'#f87171',marginTop:12}}>{error}</div>}{message&&<div style={{color:'#4ade80',marginTop:12}}>{message}</div>}
    </div>
    <div style={card}><strong style={{color:'#e2e8f0'}}>Safety</strong><p style={{color:'#94a3b8',marginBottom:0}}>Only Region Healer <code>snap_*</code> folders are rotated. Mastermind full-world backups are managed separately on the Saves page.</p></div>
  </div>;
}
