import {createServerFn} from '@tanstack/react-start';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';
import {z} from 'zod';
import {drawingSchema,measureDrawing,toMaterialReport} from './roof-geometry';
const safeStoragePath = z.string().min(1).max(300).refine(
 (path) => !path.startsWith('/') && !path.includes('\\\\') && path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..'),
 'Invalid media storage path',
);
const mediaSchema=z.array(z.object({path:safeStoragePath,name:z.string().trim().min(1).max(200),category:z.enum(['aerial','before','after','diagram']),feet_per_pixel:z.number().finite().positive().max(10).optional()})).max(30);
export const saveRoofDrawing=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((raw:unknown)=>z.object({property_id:z.string().uuid(),title:z.string().trim().min(1).max(180),geometry:drawingSchema,parent_id:z.string().uuid().nullable(),media:mediaSchema,report_order_id:z.string().uuid().optional()}).parse(raw)).handler(async({data,context})=>{
 const {data:owner}=await context.supabase.rpc('has_any_role',{_user_id:context.userId,_roles:['office','sales','production_manager']});if(!owner)throw new Error('You do not have access to this action');
 let revision=1;if(data.parent_id){const {data:parent}=await context.supabase.from('roof_drawings').select('revision,property_id').eq('id',data.parent_id).single();if(!parent||parent.property_id!==data.property_id)throw new Error('Drawing property does not match');revision=parent.revision+1;}
 if(data.report_order_id){const {data:report}=await context.supabase.from('roof_report_orders').select('property_id').eq('id',data.report_order_id).single();if(!report||report.property_id!==data.property_id)throw new Error('Report property does not match');}
 const measurements=measureDrawing(data.geometry);
 if(data.report_order_id){
  const {data:id,error:rpcError}=await context.supabase.rpc('save_report_drawing',{p_drawing:{property_id:data.property_id,title:data.title,geometry:data.geometry,measurements,revision,parent_id:data.parent_id??'',media:data.media} as never,p_report_id:data.report_order_id,p_report:{measurements:toMaterialReport(data.geometry),notes:data.geometry.notes,verified:data.geometry.verified} as never});
  if(rpcError||!id)throw new Error('Could not save drawing and report');
  const {data:saved,error:readError}=await context.supabase.from('roof_drawings').select('*').eq('id',id).single();if(readError||!saved)throw new Error('Drawing saved but could not reload');
  return saved;
 }
 const {data:row,error}=await context.supabase.from('roof_drawings').insert({...data,report_order_id:null,revision,measurements}).select('*').single();if(error||!row)throw new Error('Could not save drawing');
 return row;
});