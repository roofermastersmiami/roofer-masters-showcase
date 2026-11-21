import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { customerSchema } from './crm-foundation';
export const saveCustomer=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>customerSchema.parse(input)).handler(async({data,context})=>{
 const {data:id,error}=await context.supabase.rpc('save_crm_customer',{p_customer:data});if(error||!id)throw new Error('Could not save this customer');return {id};
});