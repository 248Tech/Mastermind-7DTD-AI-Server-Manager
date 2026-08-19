import { NextRequest } from 'next/server';

export const dynamic='force-dynamic';
const editor=()=>(process.env.PROFILE_EDITOR_INTERNAL_URL||'http://profile-editor:8000').replace(/\/$/,'');
const control=()=>(process.env.CONTROL_PLANE_INTERNAL_URL||'http://control-plane:3001').replace(/\/$/,'');

async function proxy(request:NextRequest,{params}:{params:Promise<{path:string[]}>}){
 const token=request.cookies.get('mm_profile_editor_session')?.value;
 if(!token)return Response.json({message:'Profile Editor session required'},{status:401});
 const auth=await fetch(`${control()}/api/auth/me`,{headers:{authorization:`Bearer ${token}`},cache:'no-store'}).catch(()=>null);
 if(!auth?.ok)return Response.json({message:'Profile Editor session expired'},{status:401});
 const routeParams=await params;
 const path=(routeParams.path||['index.php']).join('/');
 const target=new URL(`${editor()}/${path}`);
 request.nextUrl.searchParams.forEach((value,key)=>target.searchParams.append(key,value));
 const headers=new Headers(request.headers);
 headers.delete('host');headers.delete('content-length');headers.delete('accept-encoding');headers.delete('cookie');
 const phpSession=request.cookies.get('PHPSESSID')?.value;
 if(phpSession)headers.set('cookie',`PHPSESSID=${phpSession}`);
 const body=request.method==='GET'||request.method==='HEAD'?undefined:await request.arrayBuffer();
 try{
  const response=await fetch(target,{method:request.method,headers,body,redirect:'manual',cache:'no-store'});
  const outputHeaders=new Headers(response.headers);
  outputHeaders.delete('content-length');outputHeaders.delete('content-encoding');outputHeaders.delete('transfer-encoding');
  const phpCookie=response.headers.get('set-cookie');
  if(phpCookie)outputHeaders.set('set-cookie',phpCookie.replace(/Path=\/?/i,'Path=/api/profile-editor-tool'));
  if(path==='save.php'&&response.ok){
   const edited=await response.arrayBuffer();
   const encodedTarget=request.cookies.get('mm_profile_editor_target')?.value;
   if(encodedTarget){
    try{
     const selected=JSON.parse(Buffer.from(encodedTarget,'base64url').toString()) as {orgId:string;serverId:string;path:string};
     const staged=await fetch(`${control()}/api/orgs/${encodeURIComponent(selected.orgId)}/jobs`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({serverInstanceId:selected.serverId,type:'PROFILE_STAGE',payload:{path:selected.path,contentBase64:Buffer.from(edited).toString('base64')}}),cache:'no-store'});
     if(!staged.ok)return Response.json({message:'The profile was edited but could not be queued for the next restart'},{status:502});
     const queued=await staged.json().catch(()=>null) as {jobRunId?:string}|null;
     outputHeaders.set('x-mastermind-profile-staged','true');
     if(queued?.jobRunId)outputHeaders.set('x-mastermind-profile-job-run-id',queued.jobRunId);
    }catch{return Response.json({message:'Invalid staged profile target'},{status:400});}
   }
   return new Response(edited,{status:response.status,headers:outputHeaders});
  }
  return new Response(response.body,{status:response.status,headers:outputHeaders});
 }catch(error){return Response.json({message:'7D2D Profile Editor service is unavailable',detail:error instanceof Error?error.message:String(error)},{status:503});}
}
export const GET=proxy;
export const POST=proxy;
