import {createServerFn} from '@tanstack/react-start';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';
import {z} from 'zod';
import {drawingSchema,measureDrawing} from './roof-geometry';
const mediaSchema=z.array(z.object({path:z.string().max(300),name:z.string().max(200),category:z.enum(['aerial','before','after','diagram'])})).max(30);
export const saveRoofDrawing=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((raw:unknown)=>z.object({property_id:z.string().uuid(),title:z.string().trim().min(1).max(180),geometry:drawingSchema,parent_id:z.string().uuid().nullable(),media:mediaSchema}).parse(raw)).handler(async({data,context})=>{
 const {data:owner}=await context.supabase.rpc('has_role',{_user_id:context.userId,_role:'admin'});if(!owner)throw new Error('Owner access required');
 let revision=1;if(data.parent_id){const {data:parent}=await context.supabase.from('roof_drawings').select('revision,property_id').eq('id',data.parent_id).single();if(!parent||parent.property_id!==data.property_id)throw new Error('Drawing property does not match');revision=parent.revision+1;}
 const measurements=measureDrawing(data.geometry);
 const {data:row,error}=await context.supabase.from('roof_drawings').insert({...data,revision,measurements}).select('*').single();if(error||!row)throw new Error('Could not save drawing');return row;
});