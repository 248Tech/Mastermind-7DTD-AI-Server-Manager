import { NextRequest } from 'next/server';
import { readFile, readdir } from 'fs/promises';
import pathModule from 'path';

export const dynamic = 'force-dynamic';
type Entity = { id:number; name:string; type:string; position:{x:number;y:number;z:number} };
type EntityFeed = { players: Entity[]; animals: Entity[]; hostiles: Entity[]; playerVisibility?: string; errors?: Record<string, string> };
const entityRates=new Map<string,{window:number;count:number}>();

async function playerProfile(request: NextRequest) {
  const token = request.cookies.get('mm_player_session')?.value;
  if (!token) return null;
  const control = (process.env.CONTROL_PLANE_INTERNAL_URL || 'http://control-plane:3001').replace(/\/$/, '');
  const response = await fetch(`${control}/api/player-auth/me`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null);
  if (!response?.ok) return null;
  const body = await response.json() as { entityId: number | null; name: string; online: boolean; auth?: string };
  if (body.auth === 'name') return null;
  return body;
}

async function liveEntities(request: NextRequest) {
  const control = (process.env.CONTROL_PLANE_INTERNAL_URL || 'http://control-plane:3001').replace(/\/$/, '');
  const headers = new Headers();
  const token = request.cookies.get('mm_player_session')?.value;
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${control}/api/player-auth/map/entities`, {
    headers,
    cache: 'no-store',
    redirect: 'error',
  }).catch(() => null);
  if (!response) throw new Error('Live entities unavailable');
  const body = await response.json().catch(() => ({})) as EntityFeed & { message?: string };
  if (!response.ok) throw new Error(body.message || 'Live entities unavailable');
  return {
    players: Array.isArray(body.players) ? body.players : [],
    animals: Array.isArray(body.animals) ? body.animals : [],
    hostiles: Array.isArray(body.hostiles) ? body.hostiles : [],
    playerVisibility: body.playerVisibility,
    errors: body.errors,
  };
}

function entityRateAllowed(request:NextRequest,verified:boolean){
  const key=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'local';const now=Date.now(),window=Math.floor(now/60000),limit=verified?120:30,current=entityRates.get(key);
  if(!current||current.window!==window){entityRates.set(key,{window,count:1});return true;}current.count++;if(entityRates.size>2000)for(const [ip,value] of entityRates)if(value.window<window)entityRates.delete(ip);return current.count<=limit;
}

async function mapConfig() {
  let maxZoom=4,mapSize=10240;
  try { const levels=await readdir('/7dtd-map',{withFileTypes:true});const zooms=levels.filter(e=>e.isDirectory()&&/^\d+$/.test(e.name)).map(e=>Number(e.name));if(zooms.length)maxZoom=Math.max(...zooms); } catch {}
  try { const files=await readdir('/7dtd-save/Region',{withFileTypes:true});const coords=files.flatMap(e=>{const m=e.isFile()?/^r\.(-?\d+)\.(-?\d+)\.7rg$/i.exec(e.name):null;return m?[[Number(m[1]),Number(m[2])]]:[];});if(coords.length){const xs=coords.map(([x])=>x),zs=coords.map(([,z])=>z);mapSize=Math.max((Math.max(...xs)-Math.min(...xs)+1)*512,(Math.max(...zs)-Math.min(...zs)+1)*512);}} catch {}
  return { enabled:true,mapBlockSize:128,maxZoom,mapSize:{x:mapSize,y:255,z:mapSize},offline:true };
}

export async function GET(request:NextRequest,{params}:{params:Promise<{path:string[]}>}){
  const profile=await playerProfile(request);
  const routeParams=await params;
  const path=(routeParams.path||[]).join('/');
  if(path==='api/map/config')return Response.json({data:await mapConfig()},{headers:{'cache-control':'private, no-store'}});
  if(path==='entities-live'){
    if(!entityRateAllowed(request,Boolean(profile)))return Response.json({message:'Live map refresh limit reached; wait a moment'},{status:429,headers:{'retry-after':'30'}});
    try{
      const feed=await liveEntities(request);
      const errorText=feed.errors?Object.values(feed.errors).filter(Boolean).join(' · '):'';
      return Response.json({data:{players:feed.players,playerVisibility:feed.playerVisibility||(profile?'verified':'hidden'),animals:feed.animals,hostiles:feed.hostiles,...(errorText?{errors:feed.errors}:{})}},{headers:{'cache-control':'private, no-store'}});
    }catch(error){return Response.json({message:error instanceof Error?error.message:'Live entities unavailable'},{status:503});}
  }
  const tile=path.match(/^map\/(\d+)\/(-?\d+)\/(-?\d+)\.png$/);if(!tile)return Response.json({message:'Unsupported player map resource'},{status:404});
  const zoom=Number(tile[1]),x=Number(tile[2]),gameY=-Number(tile[3])-1;if(!Number.isInteger(zoom)||zoom<0||zoom>8||!Number.isInteger(x)||!Number.isInteger(gameY))return Response.json({message:'Invalid map tile'},{status:400});
  const root='/7dtd-map',file=pathModule.join(root,String(zoom),String(x),`${gameY}.png`);if(!file.startsWith(root+pathModule.sep))return Response.json({message:'Invalid map tile'},{status:400});
  try{return new Response(await readFile(file),{headers:{'content-type':'image/png','cache-control':'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'}});}catch{return new Response(null,{status:404});}
}
