import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, options, required } from '../_shared/http.ts';
Deno.serve(async (req) => {
  const pre=options(req); if(pre)return pre;
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try {
    const auth=req.headers.get('Authorization'); if(!auth)return json({error:'Sign in required'},401);
    const url=required('SUPABASE_URL'), anon=required('SUPABASE_ANON_KEY'), service=required('SUPABASE_SERVICE_ROLE_KEY');
    const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
    const {data:{user},error}=await userClient.auth.getUser(); if(error||!user)return json({error:'Invalid session'},401);
    const {application_id,decision,notes}=await req.json(); if(!application_id||!['approve','reject','needs_correction','under_review'].includes(decision))return json({error:'Valid application_id and decision are required.'},400);
    const {data:app,error:appErr}=await userClient.from('admission_applications').select('id,school_id,status').eq('id',application_id).maybeSingle();
    if(appErr||!app)return json({error:'Application not found or not accessible.'},404);
    const {data:membership}=await userClient.from('school_memberships').select('role,status').eq('school_id',app.school_id).eq('user_id',user.id).eq('status','active').maybeSingle();
    if(!membership||!['secretary','principal','school_admin'].includes(membership.role))return json({error:'Not authorized to review admissions.'},403);
    const admin=createClient(url,service);
    if(decision==='approve'){
      const {data,error:rpcError}=await admin.rpc('approve_admission_application',{p_application_id:application_id,p_reviewer:user.id});
      if(rpcError)throw new Error(rpcError.message);
      return json({status:'approved',student:data?.[0]||null},200);
    }
    const status=decision==='reject'?'rejected':decision==='needs_correction'?'needs_correction':'under_review';
    const {error:updateErr}=await admin.from('admission_applications').update({status,review_notes:notes||null,reviewed_by:user.id,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',application_id).eq('school_id',app.school_id);
    if(updateErr)throw updateErr;
    await admin.from('audit_logs').insert({school_id:app.school_id,actor_user_id:user.id,action:`admission_${status}`,entity_type:'admission_application',entity_id:application_id,after_data:{notes:notes||null}});
    return json({status},200);
  } catch(e) { console.error('admission-review error',e); return json({error:e instanceof Error?e.message:'Admission review failed'},500); }
});
