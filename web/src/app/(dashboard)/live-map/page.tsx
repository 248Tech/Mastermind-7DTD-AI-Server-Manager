'use client';
import dynamic from 'next/dynamic';
const LiveMap=dynamic(()=>import('./LiveMapClient'),{ssr:false,loading:()=> <p style={{color:'#64748b'}}>Loading map…</p>});
export default function LiveMapPage(){return <LiveMap/>;}
