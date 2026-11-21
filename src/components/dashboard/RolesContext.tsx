import { createContext, useContext } from 'react';
import { queryOptions } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
export const myRolesQuery = (userId: string) => queryOptions({
  queryKey: ['my-roles', userId],
  queryFn: async () => { const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId); if (error) throw error; return (data ?? []).map(r => r.role as string); },
});
export const RolesContext = createContext<string[]>([]);
export const useRoles = () => useContext(RolesContext);
