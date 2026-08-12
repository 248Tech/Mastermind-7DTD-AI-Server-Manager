import { NextRequest,NextResponse } from 'next/server';

export async function POST(request:NextRequest){
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return NextResponse.json({message:'Authentication required'},{status:401});
 const control=(process.env.CONTROL_PLANE_INTERNAL_URL||'http://control-plane:3001').replace(/\/$/,'');
 const check=await fetch(`${control}/api/auth/me`,{headers:{authorization},cache:'no-store'}).catch(()=>null);
 if(!check?.ok)return NextResponse.json({message:'Mastermind session is invalid'},{status:401});
 const response=NextResponse.json({ok:true});
 response.cookies.set('mm_profile_editor_session',authorization.slice(7),{httpOnly:true,sameSite:'strict',secure:request.nextUrl.protocol==='https:',path:'/api/profile-editor-tool',maxAge:3600});
 const body=await request.json().catch(()=>({})) as {orgId?:string;serverId?:string;path?:string};
 if(body.orgId&&body.serverId&&body.path){
  response.cookies.set('mm_profile_editor_target',Buffer.from(JSON.stringify({orgId:body.orgId,serverId:body.serverId,path:body.path})).toString('base64url'),{httpOnly:true,sameSite:'strict',secure:request.nextUrl.protocol==='https:',path:'/api/profile-editor-tool',maxAge:3600});
 }else response.cookies.delete('mm_profile_editor_target');
 return response;
}
