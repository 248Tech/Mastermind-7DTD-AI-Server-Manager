'use client';
import { useCallback, useState } from 'react';
import { api, Host, ServerInstance } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import { usePoll } from '../../../hooks/useRealtime';

const card:React.CSSProperties={background:'#111118',border:'1px solid #1e1e2a',borderRadius:10,padding:'1.25rem'};
function relative(value:string|null){if(!value)return'Never';const seconds=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/1000));if(seconds<60)return`${seconds}s ago`;if(seconds<3600)return`${Math.floor(seconds/60)}m ago`;if(seconds<86400)return`${Math.floor(seconds/3600)}h ago`;return`${Math.floor(seconds/86400)}d ago`;}
function Status({online}:{online:boolean}){return <span style={{color:online?'#4ade80':'#f87171',background:online?'rgba(34,197,94,.1)':'rgba(239,68,68,.1)',borderRadius:20,padding:'.25rem .6rem',fontSize:'.75rem',fontWeight:600}}>{online?'● Online':'○ Offline'}</span>}

export default function DashboardPage(){
  const orgId=getStoredOrgId();const [servers,setServers]=useState<ServerInstance[]>([]);const [hosts,setHosts]=useState<Host[]>([]);const [error,setError]=useState('');
  const fetchAll=useCallback(async()=>{if(!orgId)return{servers:[],hosts:[]};const [s,h]=await Promise.all([api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`),api.get<Host[]>(`/api/orgs/${orgId}/hosts`)]);return{servers:s,hosts:h};},[orgId]);
  usePoll(fetchAll,data=>{setServers(data.servers);setHosts(data.hosts);setError('');},10000,!!orgId);
  const hostFor=(server:ServerInstance)=>hosts.find(h=>h.id===server.hostId);const online=servers.filter(s=>hostFor(s)?.status==='online').length;
  return <div><div style={{marginBottom:'1.5rem'}}><h1 style={{margin:0,color:'#f1f5f9',fontSize:'1.65rem'}}>Servers</h1><p style={{color:'#64748b',margin:'.3rem 0 0'}}>Choose a server to view status, manage it, and inspect its jobs.</p></div>
    {error&&<div style={{color:'#f87171',marginBottom:12}}>{error}</div>}
    <div className="dashboard-stats-grid" style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:'1rem',marginBottom:'1.5rem'}}>
      {[['Total servers',servers.length,'#818cf8'],['Online',online,'#4ade80'],['Offline',servers.length-online,'#f87171']].map(([label,value,color])=><div key={String(label)} style={card}><div style={{color:'#64748b',fontSize:'.78rem'}}>{label}</div><div style={{color:String(color),fontSize:'1.8rem',fontWeight:700,marginTop:6}}>{value}</div></div>)}
    </div>
    {servers.length===0?<div style={card}><h2 style={{color:'#e2e8f0',marginTop:0}}>No servers registered</h2><p style={{color:'#64748b'}}>Pair a host and discover or register a game server first.</p><a href="/hosts" style={{color:'#818cf8'}}>Open host setup</a></div>:<div className="server-card-grid" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:'1rem'}}>{servers.map(server=>{const host=hostFor(server);const isOnline=host?.status==='online';return <a key={server.id} href={`/servers/${server.id}`} style={{...card,textDecoration:'none',display:'block',transition:'border-color .15s',minWidth:0}}><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start'}}><div style={{minWidth:0}}><div style={{color:'#f1f5f9',fontWeight:700,fontSize:'1.05rem',overflowWrap:'anywhere'}}>{server.name}</div><div style={{color:'#64748b',fontSize:'.78rem',marginTop:4}}>{server.gameType.toUpperCase()} · {host?.name||'Unknown host'}</div></div><Status online={isOnline}/></div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:'1.25rem'}}><div style={{minWidth:0}}><small style={{color:'#475569'}}>INSTALL PATH</small><div style={{color:'#94a3b8',fontSize:'.78rem',marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{server.installPath||'Not set'}</div></div><div><small style={{color:'#475569'}}>HOST SEEN</small><div style={{color:'#94a3b8',fontSize:'.78rem',marginTop:3}}>{relative(host?.lastHeartbeatAt||null)}</div></div></div><div style={{color:'#818cf8',fontSize:'.82rem',fontWeight:600,marginTop:'1.25rem'}}>Manage server ›</div></a>})}</div>}
  </div>;
}
