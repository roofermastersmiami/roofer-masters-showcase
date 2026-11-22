import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { authorizedClient } from '../supabase';
export default defineTool({
  name: 'list_customers', title: 'List customers',
  description: 'Read recent customer contact information accessible to your CRM team role, excluding internal notes.',
  inputSchema: { limit: z.number().int().min(1).max(50).default(20).describe('Maximum recent customers to return, from 1 to 50.') },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    const client = await authorizedClient(ctx, 'customers');
    const { data, error } = await client.from('crm_customers').select('id,name,email,phone,customer_type').order('created_at', { ascending: false }).limit(limit).abortSignal(ctx.signal);
    if (error) throw new ToolError('Could not read customers. Try again.');
    const customers = (data ?? []).map(row => ({ ...row }));
    return { content: [{ type: 'text', text: JSON.stringify({ customers }) }], structuredContent: { customers } };
  },
});