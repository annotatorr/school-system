import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, options, required } from '../_shared/http.ts';
Deno.serve(async(req)=>{
 const pre=options(req);if(pre)return pre;if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const auth=req.headers.get('Authorization');if(!auth)return json({error:'Sign in required'},401);
  const url=required('SUPABASE_URL');const anon=required('SUPABASE_ANON_KEY');const service=required('SUPABASE_SERVICE_ROLE_KEY');
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user},error:userErr}=await userClient.auth.getUser();if(userErr||!user)return json({error:'Invalid session'},401);
  const {school_id,class_id,subject_id,kind='assignment',notes,title='',difficulty='mixed',question_count=10,question_types=['short_answer'],marks_total=null}=await req.json();
  if(!school_id||!class_id||!notes||String(notes).trim().length<30)return json({error:'Provide school, class and at least 30 characters of teacher notes.'},400);
  if(!['assignment','exam'].includes(kind))return json({error:'Unsupported content type.'},400);
  const {data:membership}=await userClient.from('school_memberships').select('role,status').eq('school_id',school_id).eq('user_id',user.id).eq('status','active').maybeSingle();
  if(!membership||!['teacher','principal','school_admin'].includes(membership.role))return json({error:'Only an approved teacher or authorized school leader can generate learning content.'},403);
    const admin=createClient(url,service);
    const [schoolResult,classResult,subjectResult]=await Promise.all([
        admin.from('schools').select('id,status').eq('id',school_id).maybeSingle(),
        admin.from('classes').select('id').eq('id',class_id).eq('school_id',school_id).maybeSingle(),
        subject_id
            ? admin.from('subjects').select('id').eq('id',subject_id).eq('school_id',school_id).maybeSingle()
            : Promise.resolve({data:null,error:null}),
    ]);
    if(schoolResult.error||classResult.error||subjectResult.error)throw new Error('Could not validate the selected school, class, or subject.');
    if(!schoolResult.data||schoolResult.data.status!=='active')return json({error:'School is not active.'},403);
    if(!classResult.data)return json({error:'Class does not belong to the selected school.'},400);
    if(subject_id&&!subjectResult.data)return json({error:'Subject does not belong to the selected school.'},400);
    if(membership.role==='teacher'){
        if(!subject_id)return json({error:'Teachers must select an assigned subject.'},400);
        const {data:assignment,error:assignmentError}=await admin.from('teacher_assignments')
            .select('id')
            .eq('school_id',school_id)
            .eq('teacher_id',user.id)
            .eq('class_id',class_id)
            .eq('subject_id',subject_id)
            .maybeSingle();
        if(assignmentError)throw new Error('Could not verify the teacher assignment.');
        if(!assignment)return json({error:'You are not assigned to this class and subject.'},403);
    }
  if(!Number.isInteger(question_count)||question_count<1||question_count>60)return json({error:'Question count must be between 1 and 60.'},400);
  const apiKey=required('AI_API_KEY'),base=(Deno.env.get('AI_BASE_URL')||'https://api.openai.com/v1').replace(/\/$/,''),model=required('AI_MODEL');
  const prompt=`Create a DRAFT ${kind.toUpperCase()} for a Kenyan school. Use ONLY the teacher notes as factual source. If the notes do not support a question, state that limitation instead of inventing facts. Do not include an answer key in student-facing exam content. Return JSON with title, instructions, questions (each has number,type,question,marks,options where relevant), total_marks, source_coverage_notes.\nTitle: ${title||kind}\nDifficulty: ${difficulty}\nQuestion count: ${question_count}\nQuestion types: ${JSON.stringify(question_types)}\nRequested total marks: ${marks_total??'derive a sensible total'}\nTeacher notes:\n${String(notes).slice(0,24000)}`;
  const response=await fetch(`${base}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,temperature:0.3,response_format:{type:'json_object'},messages:[{role:'system',content:'You are an educational drafting assistant. Produce safe, age-appropriate, curriculum-conscious drafts. The teacher must review all output. Never claim curriculum alignment unsupported by the supplied notes.'},{role:'user',content:prompt}]})});
  const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'AI provider request failed');let draft;try{draft=JSON.parse(result.choices?.[0]?.message?.content||'{}')}catch{throw new Error('AI returned invalid JSON. Try again or reduce the notes.');}
    const {data:record,error:insertErr}=await admin.from('assignments').insert({school_id,teacher_id:user.id,class_id,subject_id:subject_id||null,title:draft.title||title||`Draft ${kind}`,instructions:draft.instructions||'',content:{...draft,kind,ai_generated:true,model,teacher_notes_provided:true},status:'draft'}).select('id,title,status,created_at').single();
  if(insertErr)throw new Error('Draft generated but could not be saved. Check class, subject and database permissions.');
    await admin.from('audit_logs').insert({school_id,actor_user_id:user.id,action:'ai_draft_generated',entity_type:'assignment',entity_id:record.id,after_data:{kind,model}});
  return json({draft:record,content:draft,requires_teacher_review:true},201);
 }catch(e){console.error('ai-generate error',e);return json({error:e instanceof Error?e.message:'AI generation failed'},500);}
});