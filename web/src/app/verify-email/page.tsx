'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';

export default function VerifyEmailPage() {
  const params=useSearchParams();const router=useRouter();const [message,setMessage]=useState('Confirming your email address…');const [failed,setFailed]=useState(false);
  useEffect(()=>{const token=params.get('token');if(!token){setFailed(true);setMessage('This confirmation link is missing its token.');return;}api.post<{approval_required:true;email:string}>('/api/auth/verify-email',{token}).then(result=>{setMessage(`Email confirmed for ${result.email}. An administrator must approve the account before sign-in.`);setTimeout(()=>router.replace('/login'),2500);}).catch(error=>{setFailed(true);setMessage(error instanceof Error?error.message:'Could not confirm this email address');});},[params,router]);
  return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#0a0a0f',padding:20}}><section style={{maxWidth:480,padding:32,border:'1px solid #252532',borderRadius:14,background:'#111118',textAlign:'center'}}><h1 style={{color:'#f1f5f9',marginTop:0}}>Email confirmation</h1><p style={{color:failed?'#f87171':'#94a3b8'}}>{message}</p>{failed&&<a href="/login" style={{color:'#818cf8'}}>Return to sign in</a>}</section></main>;
}
