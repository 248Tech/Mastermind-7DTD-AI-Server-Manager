'use client';
import dynamic from 'next/dynamic';
const PlayerMap=dynamic(()=>import('./PlayerMapClient'),{ssr:false,loading:()=> <p style={{color:'#94a3b8',padding:'2rem'}}>Loading player map…</p>});
export default function PlayerMapPage(){return <PlayerMap/>;}
