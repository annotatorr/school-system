import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, options, required } from '../_shared/http.ts';
Deno.serve(async (req) => {
  const pre=options(req); if(pre)return pre;
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try {
    const auth=req.headers.get('Authorization'); if(!auth)return json({error:'Sign in required'},401);
    const url=required('SUPABASE_URL'),anon=required('SUPABASE_ANON_KEY'),service=required('SUPABASE_SERVICE_ROLE_KEY');
    const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
    const {data:{user},error}=await userClient.auth.getUser();if(error||!user)return json({error:'Invalid session'},401);
    const {application_id,decision,notes}=await req.json();if(!application_id||!['approved','rejected'].includes(decision))return json({error:'Valid application_id and decision are required.'},400);
    const {data:app,error:appErr}=await userClient.from('teacher_applications').select('id,school_id,status').eq('id',application_id).maybeSingle();if(appErr||!app)return json({error:'Teacher application not found or not accessible.'},404);
    const {data:membership}=await userClient.from('school_memberships').select('role,status').eq('school_id',app.school_id).eq('user_id',user.id).eq('status','active').maybeSingle();
    if(!membership||membership.role!=='secretary')return json({error:'Only the school secretary can approve or reject teacher sign-ups.'},403);
    const admin=createClient(url,service);const {error:rpcError}=await admin.rpc('review_teacher_application',{p_application_id:application_id,p_reviewer:user.id,p_decision:decision,p_notes:notes||null});if(rpcError)throw new Error(rpcError.message);
    return json({status:decision},200);
  } catch(e) {console.error('teacher-application-review error',e);return json({error:e instanceof Error?e.message:'Teacher review failed'},500);}
});
