import {it,expect,describe} from 'vitest';
import {priceOption,actualProfit,materialSystem,projectInvoices,type EstimateOption} from '@/lib/advanced-estimate';
const option:EstimateOption={id:'a',name:'Metal option',system:'Metal Roof',lines:[{id:'a',description:'Panels',category:'materials',quantity:10,unit:'panels',unit_cents:10000}],overhead_pct:10,margin_pct:20,discount_cents:0,tax_pct:10,deposit_pct:30};
describe('estimate and recorded profitability',()=>{
it('calculates margin rather than markup and reconciles deposit/balance',()=>{expect(priceOption(option)).toMatchObject({direct:100000,overhead:10000,cost:110000,subtotal:137500,tax:13750,total:151250,deposit:45375,balance:105875});});
it('rejects discounts above the selling price',()=>expect(()=>priceOption({...option,discount_cents:200000})).toThrow('Discount'));
it('rejects estimate line collections whose aggregate exceeds safe currency precision',()=>{
 const many=Array.from({length:150},(_,i)=>({id:String(i),description:'Roof material',category:'materials' as const,quantity:1000000,unit:'unit',unit_cents:100000000}));
 expect(()=>priceOption({...option,lines:many})).toThrow('Direct cost exceeds the supported currency range');
});
it('rejects unsafe discounts and selling-price overflow',()=>{
 expect(()=>priceOption({...option,discount_cents:Number.MAX_SAFE_INTEGER+1})).toThrow('Discount exceeds the supported currency range');
 const largeButValidLines=Array.from({length:10},(_,i)=>({...option.lines[0],id:String(i),quantity:1000000,unit_cents:100000000}));
 expect(()=>priceOption({...option,margin_pct:95,lines:largeButValidLines})).toThrow('Selling price exceeds the supported currency range');
});

it('separates actual direct costs and recorded overhead',()=>expect(actualProfit(200000,[{category:'materials',amount_cents:80000},{category:'office',amount_cents:20000}])).toMatchObject({gross:120000,net:100000,margin:50}));
it('does not claim a percentage margin without collected revenue',()=>expect(actualProfit(0,[{category:'labor',amount_cents:5000}]).margin).toBeNull());
it('does not import metal quantities for an unsupported coating system',()=>{expect(materialSystem('Coatings')).toBeNull();expect(materialSystem('Standing seam')).toBe('Metal Roof');});
it('attributes invoices only by explicit project allocations',()=>{const invoices=[{id:'one'},{id:'two'},{id:'unallocated'}],links=[{invoice_id:'one',job_id:'a'},{invoice_id:'two',job_id:'b'}];expect(projectInvoices(invoices,links,'a')).toEqual([{id:'one'}]);expect(projectInvoices(invoices,links,'b')).toEqual([{id:'two'}]);expect(projectInvoices(invoices,links,'all')).toHaveLength(3);});
});