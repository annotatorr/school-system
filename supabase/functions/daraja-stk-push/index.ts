import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json, options, required, normalizeKenyanPhone } from '../_shared/http.ts';
const supabase = () => createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'));
Deno.serve(async (req) => {
 const pre=options(req); if(pre)return pre;
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try {
  const auth=req.headers.get('Authorization'); if(!auth)return json({error:'Sign in required'},401);
  const sb=supabase(); const {data:{user},error:userErr}=await createClient(required('SUPABASE_URL'),required('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:auth}}}).auth.getUser();
  if(userErr||!user)return json({error:'Invalid session'},401);
  const body=await req.json(); const {school_id,student_id,amount_kes,phone_number}=body;
  const amount=Number(amount_kes); if(!school_id||!student_id||!Number.isInteger(amount)||amount<1||amount>250000)return json({error:'Provide a valid student, school and amount (1–250,000 KSh).'},400);
    const {data:student,error:studentError}=await sb.from('students').select('id,school_id,admission_number,user_id').eq('id',student_id).eq('school_id',school_id).maybeSingle();
    if(studentError)throw studentError;
  if(!student)return json({error:'Student record not found for this school.'},404);
    const {data:guardian,error:guardianError}=await sb.from('guardians').select('id').eq('school_id',school_id).eq('user_id',user.id).maybeSingle();
    if(guardianError)throw guardianError;
    const {data:link,error:linkError}=guardian
        ?await sb.from('student_guardians').select('student_id').eq('school_id',school_id).eq('student_id',student_id).eq('guardian_id',guardian.id).maybeSingle()
        :{data:null,error:null};
    if(linkError)throw linkError;
    const isStudent=student.user_id===user.id;
    if(!isStudent&&!link)return json({error:'Only the student or a linked guardian can initiate this payment.'},403);
  const {data:school}=await sb.from('schools').select('status,name').eq('id',school_id).maybeSingle();
  if(!school||school.status!=='active')return json({error:'This school is not accepting new payments.'},403);
  const phone=normalizeKenyanPhone(String(phone_number||''));
  const base=Deno.env.get('DARAJA_ENV')==='production'?'https://api.safaricom.co.ke':'https://sandbox.safaricom.co.ke';
  const key=required('DARAJA_CONSUMER_KEY'),secret=required('DARAJA_CONSUMER_SECRET'),shortcode=required('DARAJA_SHORTCODE'),passkey=required('DARAJA_PASSKEY'),callback=required('DARAJA_CALLBACK_URL');
  const basic=btoa(`${key}:${secret}`);
  const tokenResponse=await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`,{headers:{Authorization:`Basic ${basic}`}});
  const tokenData=await tokenResponse.json(); if(!tokenResponse.ok||!tokenData.access_token)throw new Error('Daraja authentication failed. Check server-side credentials and environment.');
  const now=new Date(); const timestamp=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const password=btoa(`${shortcode}${passkey}${timestamp}`); const accountReference=`SCH-${student.admission_number}`.slice(0,12);
  const maintenanceFee=Number(Deno.env.get('PLATFORM_MAINTENANCE_FEE_KES')||'7');
  const {data:intent,error:insertErr}=await sb.from('payment_intents').insert({school_id,student_id,guardian_user_id:guardian?user.id:null,provider:'daraja',amount_kes:amount,maintenance_fee_kes:maintenanceFee,status:'processing',phone_number:phone,account_reference:accountReference,initiated_by:user.id}).select('id').single();
  if(insertErr||!intent)throw new Error('Could not create payment record.');
  const payload={BusinessShortCode:shortcode,Password:password,Timestamp:timestamp,TransactionType:Deno.env.get('DARAJA_TRANSACTION_TYPE')||'CustomerPayBillOnline',Amount:amount,PartyA:phone,PartyB:shortcode,PhoneNumber:phone,CallBackURL:callback,AccountReference:accountReference,TransactionDesc:'School fee payment'};
  const response=await fetch(`${base}/mpesa/stkpush/v1/processrequest`,{method:'POST',headers:{Authorization:`Bearer ${tokenData.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)}); const result=await response.json();
  if(!response.ok||result.ResponseCode!=='0') {await sb.from('payment_intents').update({status:'failed',failure_reason:result.errorMessage||result.ResponseDescription||'Daraja request rejected',provider_payload:result}).eq('id',intent.id);return json({error:'M-Pesa request was not accepted. Check the phone number and Daraja configuration.',details:result.errorMessage||result.ResponseDescription},400);}
  await sb.from('payment_intents').update({provider_request_id:result.MerchantRequestID,provider_checkout_id:result.CheckoutRequestID,provider_payload:{ResponseCode:result.ResponseCode,ResponseDescription:result.ResponseDescription}}).eq('id',intent.id);
  return json({payment_intent_id:intent.id,status:'pending',message:'STK prompt requested. Payment is not complete until the provider callback is verified.'},202);
 } catch(e) { console.error('daraja-stk-push error',e);return json({error:e instanceof Error?e.message:'Unexpected payment error'},500); }
});