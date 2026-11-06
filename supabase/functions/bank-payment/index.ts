import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, options, required } from '../_shared/http.ts';
// Generic bank/payment-gateway adapter. No bank is hard-coded because the user must choose a provider.
// Implement the selected provider's signed request + webhook verification before enabling production.
Deno.serve(async(req)=>{
 const pre=options(req);if(pre)return pre;if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const auth=req.headers.get('Authorization');if(!auth)return json({error:'Sign in required'},401);
  const url=required('SUPABASE_URL');const anon=required('SUPABASE_ANON_KEY');const sb=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user},error}=await sb.auth.getUser();if(error||!user)return json({error:'Invalid session'},401);
  const body=await req.json();if(body.action==='webhook')return json({error:'Provider webhook needs a provider-specific signature verifier. Do not enable this generic endpoint for real payments.'},501);
  const {school_id,student_id,amount_kes}=body;const amount=Number(amount_kes);if(!school_id||!student_id||!Number.isInteger(amount)||amount<1)return json({error:'Valid school, student and amount are required.'},400);
  const {data:membership}=await sb.from('school_memberships').select('role').eq('school_id',school_id).eq('user_id',user.id).eq('status','active').maybeSingle();
  const {data:guardian}=await sb.from('guardians').select('id').eq('school_id',school_id).eq('user_id',user.id).maybeSingle();
  const {data:link}=guardian?await sb.from('student_guardians').select('student_id').eq('student_id',student_id).eq('guardian_id',guardian.id).maybeSingle():{data:null};
  if(!membership&&!link)return json({error:'Not authorized for this student.'},403);
  const provider=Deno.env.get('BANK_PROVIDER_NAME');if(!provider)return json({error:'Bank provider is not configured yet. Choose a bank or payment gateway, then implement its official API adapter.'},501);
  // Deliberately do not send money or mark a payment successful until provider-specific API + webhook verification is implemented.
  return json({status:'not_configured',provider,message:'Provider name exists, but live initiation is disabled until its official API and signed callback are implemented.'},501);
 }catch(e){console.error('bank-payment error',e);return json({error:e instanceof Error?e.message:'Bank integration error'},500);}
});