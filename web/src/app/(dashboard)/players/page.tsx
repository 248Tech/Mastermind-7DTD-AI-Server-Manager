'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, PlayerRecord, ServerInstance } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';

function duration(seconds:number){const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60);return h?`${h}h ${m}m`:`${m}m`;}

export default function PlayersPage(){
  const orgId=getStoredOrgId(); const [servers,setServers]=useState<ServerInstance[]>([]); const [serverId,setServerId]=useState('');
  const [players,setPlayers]=useState<PlayerRecord[]>([]); const [error,setError]=useState(''); const [message,setMessage]=useState('');
  useEffect(()=>{if(!orgId)return;api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`).then(s=>{setServers(s);if(s[0])setServerId(s[0].id);}).catch(e=>setError(e.message));},[orgId]);
  const load=useCallback(async()=>{if(!orgId||!serverId)return;try{setPlayers(await api.get<PlayerRecord[]>(`/api/orgs/${orgId}/players?serverInstanceId=${encodeURIComponent(serverId)}`));setError('');}catch(e){setError(e instanceof Error?e.message:'Failed to load players');}},[orgId,serverId]);
  useEffect(()=>{load();const t=setInterval(load,5000);return()=>clearInterval(t);},[load]);
  async function action(player:PlayerRecord,type:'PLAYER_KICK'|'PLAYER_BAN'){
    if(!orgId)return;const identifier=player.steamId||(player.eosId?`EOS_${player.eosId}`:player.name);
    const reason=window.prompt(type==='PLAYER_KICK'?'Kick reason:':'Ban reason:',type==='PLAYER_KICK'?'Removed by administrator':'Banned by administrator');if(reason===null)return;
    const durationValue=type==='PLAYER_BAN'?window.prompt('Ban duration (examples: 1 days, 12 hours, 0 minutes for permanent):','1 days'):null;if(type==='PLAYER_BAN'&&durationValue===null)return;
    try{await api.post(`/api/orgs/${orgId}/jobs`,{serverInstanceId:serverId,type,payload:{identifier,reason,...(durationValue?{duration:durationValue}:{})}});setMessage(`${type==='PLAYER_KICK'?'Kick':'Ban'} queued for ${player.name}.`);setError('');}catch(e){setError(e instanceof Error?e.message:'Command failed');}
  }
  const th={padding:'.65rem',textAlign:'left' as const,color:'#64748b',fontSize:'.72rem',borderBottom:'1px solid #252532'};const td={padding:'.7rem',color:'#cbd5e1',fontSize:'.82rem',borderBottom:'1px solid #1a1a24'};
  return <div><div style={{display:'flex',justifyContent:'space-between',marginBottom:'1.25rem'}}><div><h1 style={{margin:0,color:'#f1f5f9',fontSize:'1.5rem'}}>Players</h1><p style={{color:'#64748b',margin:'.25rem 0 0'}}>Auto-populated from server login, spawn, and disconnect logs</p></div><select value={serverId} onChange={e=>setServerId(e.target.value)} style={{background:'#111118',color:'#e2e8f0',border:'1px solid #252532',borderRadius:6,padding:'.5rem'}}>{servers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
  {error&&<div style={{color:'#f87171',marginBottom:10}}>{error}</div>}{message&&<div style={{color:'#4ade80',marginBottom:10}}>{message}</div>}
  <div style={{background:'#111118',border:'1px solid #1e1e2a',borderRadius:9,overflow:'hidden'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Status','Name','Steam / EOS ID','Entity','Session','Lifetime','Last Seen','Actions'].map(x=><th key={x} style={th}>{x}</th>)}</tr></thead><tbody>{players.length===0?<tr><td colSpan={8} style={{...td,color:'#64748b'}}>No players discovered yet. Records appear after login/spawn lines reach the server log.</td></tr>:players.map(p=><tr key={p.id}><td style={td}><span style={{color:p.online?'#4ade80':'#64748b'}}>{p.online?'● Online':'○ Offline'}</span></td><td style={{...td,fontWeight:600}}>{p.name}</td><td style={td}><code>{p.steamId||p.eosId||'—'}</code><div style={{color:'#475569',fontSize:'.68rem'}}>{p.steamId?'Steam':p.eosId?'EOS':'Name fallback'}</div></td><td style={td}>{p.entityId??'—'}</td><td style={td}>{duration(p.sessionSeconds)}</td><td style={td}>{duration(p.lifetimeSeconds)}</td><td style={td}>{new Date(p.lastSeenAt).toLocaleString()}</td><td style={td}><div style={{display:'flex',gap:6}}><button disabled={!p.online} onClick={()=>action(p,'PLAYER_KICK')} style={{background:'#b45309',color:'white',border:0,borderRadius:5,padding:'.35rem .55rem'}}>Kick</button><button onClick={()=>action(p,'PLAYER_BAN')} style={{background:'#991b1b',color:'white',border:0,borderRadius:5,padding:'.35rem .55rem'}}>Ban</button></div></td></tr>)}</tbody></table></div></div>;
}
