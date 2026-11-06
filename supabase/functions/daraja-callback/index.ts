import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json, options, required } from '../_shared/http.ts';
Deno.serve(async(req)=>{
 const pre=options(req);if(pre)return pre;if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const expected=required('DARAJA_CALLBACK_TOKEN');const supplied=req.headers.get('x-callback-token')||new URL(req.url).searchParams.get('token');
  if(!supplied||supplied!==expected)return json({error:'Unauthorized callback'},401);
  const body=await req.json();const cb=body?.Body?.stkCallback;if(!cb?.CheckoutRequestID||typeof cb.ResultCode!=='number')return json({ResultCode:0,ResultDesc:'Callback received but payload shape was invalid'},200);
  const sb=createClient(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'));
  const {data:intent,error}=await sb.from('payment_intents').select('*').eq('provider','daraja').eq('provider_checkout_id',cb.CheckoutRequestID).maybeSingle();
  if(error||!intent){console.error('No payment intent for checkout id',cb.CheckoutRequestID);return json({ResultCode:0,ResultDesc:'Callback acknowledged; matching payment intent not found'},200);}
  const items=cb.CallbackMetadata?.Item||[];const meta:Record<string,unknown>={};for(const item of items)if(item?.Name)meta[item.Name]=item.Value;
  const success=cb.ResultCode===0;const receipt=typeof meta.MpesaReceiptNumber==='string'?meta.MpesaReceiptNumber:null;
  if(success&&!receipt){console.error('Success callback missing receipt',cb.CheckoutRequestID);return json({ResultCode:0,ResultDesc:'Callback acknowledged; receipt missing and requires reconciliation'},200);}
  const {data:result,error:finalizeError}=await sb.rpc('finalize_daraja_payment',{p_checkout_id:cb.CheckoutRequestID,p_result_code:cb.ResultCode,p_result_desc:String(cb.ResultDesc||''),p_receipt:receipt,p_metadata:meta});
  if(finalizeError)throw finalizeError;
  if(result==='not_found')console.error('Callback checkout id has no matching payment intent',cb.CheckoutRequestID);
  return json({ResultCode:0,ResultDesc:`Callback processed: ${result}`},200);
 }catch(e){console.error('daraja-callback error',e);return json({ResultCode:0,ResultDesc:'Callback acknowledged; internal processing needs review'},200);}
});