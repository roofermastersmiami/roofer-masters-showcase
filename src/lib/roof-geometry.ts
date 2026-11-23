import {z} from 'zod';
import earcut from 'earcut';
import polygonClipping from 'polygon-clipping';
export const EDGE_TYPES=['eave','rake','ridge','hip','valley','other'] as const;
export type EdgeType=typeof EDGE_TYPES[number];
export type Point={x:number;y:number;z:number};
export const pointSchema=z.object({x:z.number().finite().min(-10000).max(10000),y:z.number().finite().min(0).max(10000),z:z.number().finite().min(-10000).max(10000)});
export const planeSchema=z.object({id:z.string().trim().min(1).max(100),name:z.string().trim().min(1).max(100),points:z.array(pointSchema).min(3).max(100),edges:z.array(z.enum(EDGE_TYPES)).min(3).max(100)}).refine(p=>p.edges.length===p.points.length,'Each edge needs a classification');
export const drawingSchema=z.object({planes:z.array(planeSchema).min(1).max(100),penetrations:z.array(z.object({id:z.string().trim().min(1).max(100),kind:z.enum(['chimney','skylight','vent','pipe','other']),x:z.number().finite().min(-10000).max(10000),z:z.number().finite().min(-10000).max(10000),width:z.number().finite().positive().max(10000),length:z.number().finite().positive().max(10000)})).max(500),waste:z.number().min(0).max(50),roof_type:z.enum(['Metal Roof','Shingle Roof','Tile Roof','TPO','Flat Roof']),notes:z.string().max(4000),condition:z.string().max(1000),verified:z.boolean(),accuracy:z.enum(['photo_estimate','scaled','site_verified']).optional(),image_credit:z.string().max(300).optional(),metal_panel_width_inches:z.number().min(6).max(60).optional()}).superRefine((drawing,ctx)=>{const planeIds=new Set<string>();drawing.planes.forEach((plane,index)=>{if(planeIds.has(plane.id))ctx.addIssue({code:z.ZodIssueCode.custom,path:['planes',index,'id'],message:'Roof plane IDs must be unique'});planeIds.add(plane.id);});const penetrationIds=new Set<string>();drawing.penetrations.forEach((penetration,index)=>{if(penetrationIds.has(penetration.id))ctx.addIssue({code:z.ZodIssueCode.custom,path:['penetrations',index,'id'],message:'Penetration IDs must be unique'});penetrationIds.add(penetration.id);});});
export type RoofDrawing=z.infer<typeof drawingSchema>;
export type RoofPlane=z.infer<typeof planeSchema>;
export const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const sub=(a:Point,b:Point)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const cross=(a:Point,b:Point)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const dot=(a:Point,b:Point)=>a.x*b.x+a.y*b.y+a.z*b.z;
export function planeInfo(p:RoofPlane){
 for(let i=0;i<p.points.length;i++){const a=p.points[i],b=p.points[(i+1)%p.points.length];if(a&&b&&distance(a,b)<0.001)throw new Error(`${p.name}: consecutive roof corners must be distinct`);}
 for(let i=0;i<p.points.length;i++)for(let j=i+1;j<p.points.length;j++){if(j===i+1||(i===0&&j===p.points.length-1))continue;const a=p.points[i],b=p.points[(i+1)%p.points.length],c=p.points[j],d=p.points[(j+1)%p.points.length];if(!a||!b||!c||!d)continue;const side=(u:Point,v:Point,w:Point)=>(v.x-u.x)*(w.z-u.z)-(v.z-u.z)*(w.x-u.x);const onSegment=(u:Point,v:Point,w:Point)=>Math.abs(side(u,v,w))<=0.000001&&w.x>=Math.min(u.x,v.x)-0.000001&&w.x<=Math.max(u.x,v.x)+0.000001&&w.z>=Math.min(u.z,v.z)-0.000001&&w.z<=Math.max(u.z,v.z)+0.000001;const abC=side(a,b,c),abD=side(a,b,d),cdA=side(c,d,a),cdB=side(c,d,b);if((abC*abD<0&&cdA*cdB<0)||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b))throw new Error(`${p.name}: roof edges cross or touch`);}
 const a=p.points[0],b=p.points[1],c=p.points[2];if(!a||!b||!c)throw new Error('A plane needs three vertices');
 const n=cross(sub(b,a),sub(c,a));const mag=Math.hypot(n.x,n.y,n.z);if(mag<0.0001||Math.abs(n.y)<0.0001)throw new Error(`${p.name}: zero area or vertical plane`);
 for(const v of p.points)if(Math.abs(dot(n,sub(v,a)))/mag>0.02)throw new Error(`${p.name}: vertices must lie on one roof plane`);
 const triangles=earcut(p.points.flatMap(v=>[v.x,v.z]));let area=0;
 for(let i=0;i<triangles.length;i+=3){const ai=triangles[i],bi=triangles[i+1],ci=triangles[i+2];if(ai===undefined||bi===undefined||ci===undefined)continue;const av=p.points[ai],bv=p.points[bi],cv=p.points[ci];if(!av||!bv||!cv)continue;const cr=cross(sub(bv,av),sub(cv,av));area+=Math.hypot(cr.x,cr.y,cr.z)/2;}
 if(area<=0)throw new Error(`${p.name}: invalid area`);
 return {area,pitch:12*Math.hypot(n.x,n.z)/Math.abs(n.y),triangles};
}
const ring=(p:RoofPlane):[number,number][]=>{const points=p.points.map(v=>[v.x,v.z] as [number,number]);const first=points[0];return first?[...points,first]:points;};
function ringArea(r:number[][]){let area=0;for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];if(a&&b)area+=(a[0]??0)*(b[1]??0)-(b[0]??0)*(a[1]??0);}return Math.abs(area)/2;}
function edgeKey(a:Point,b:Point){const key=(p:Point)=>[p.x,p.y,p.z].map(n=>Math.round(n*1000)).join(',');return [key(a),key(b)].sort().join('|');}

export function measureDrawing(raw:RoofDrawing){
 const d=drawingSchema.parse(raw);const planes=d.planes.map(p=>({...planeInfo(p),id:p.id,name:p.name}));
 for(let i=0;i<d.planes.length;i++)for(let j=i+1;j<d.planes.length;j++){const a=d.planes[i],b=d.planes[j];if(!a||!b)continue;const intersection=polygonClipping.intersection([ring(a)],[ring(b)]);if(intersection.reduce((sum,poly)=>sum+ringArea(poly[0]??[]),0)>0.1)throw new Error(`${a.name} overlaps ${b.name} in plan`);}
 const footprint=polygonClipping.union(...d.planes.map(p=>[ring(p)]));
 for(const penetration of d.penetrations){const halfW=penetration.width/2,halfL=penetration.length/2;const penetrationRing:[[number,number],[number,number],[number,number],[number,number],[number,number]]=[[penetration.x-halfW,penetration.z-halfL],[penetration.x+halfW,penetration.z-halfL],[penetration.x+halfW,penetration.z+halfL],[penetration.x-halfW,penetration.z+halfL],[penetration.x-halfW,penetration.z-halfL]];const outside=polygonClipping.difference([[penetrationRing]],footprint);const outsideArea=outside.reduce((sum,poly)=>sum+ringArea(poly[0]??[])-poly.slice(1).reduce((holes,hole)=>holes+ringArea(hole),0),0);if(outsideArea>0.0001)throw new Error(`Penetration ${penetration.id} must fit within the roof footprint`);}
 for(let i=0;i<d.penetrations.length;i++)for(let j=i+1;j<d.penetrations.length;j++){const a=d.penetrations[i],b=d.penetrations[j];if(!a||!b)continue;const overlapX=Math.min(a.x+a.width/2,b.x+b.width/2)-Math.max(a.x-a.width/2,b.x-b.width/2);const overlapZ=Math.min(a.z+a.length/2,b.z+b.length/2)-Math.max(a.z-a.length/2,b.z-b.length/2);if(overlapX>0.001&&overlapZ>0.001)throw new Error(`Penetrations ${a.id} and ${b.id} overlap`);}
 const edges:Record<EdgeType,number>={eave:0,rake:0,ridge:0,hip:0,valley:0,other:0};const seen=new Map<string,EdgeType>();
 for(const p of d.planes)for(let i=0;i<p.points.length;i++){const a=p.points[i],b=p.points[(i+1)%p.points.length],type=p.edges[i];if(!a||!b||!type)continue;const key=edgeKey(a,b),existing=seen.get(key);if(existing&&existing!==type)throw new Error('Shared edges must have matching classifications');if(!existing){edges[type]+=distance(a,b);seen.set(key,type);}}
 const exterior=new Map<string,{length:number;count:number}>();for(const p of d.planes)for(let i=0;i<p.points.length;i++){const a=p.points[i],b=p.points[(i+1)%p.points.length];if(!a||!b)continue;const key=edgeKey(a,b),existing=exterior.get(key);if(existing)existing.count++;else exterior.set(key,{length:distance(a,b),count:1});}
 const perimeter=[...exterior.values()].filter(e=>e.count===1).reduce((sum,e)=>sum+e.length,0);
 const area=planes.reduce((sum,p)=>sum+p.area,0);return {area,squares:area/100,withWaste:area*(1+d.waste/100),edges,planes,perimeter,penetrations:d.penetrations.length};
}
export type RoofShape='gable'|'hip'|'flat'|'shed'|'mansard'|'complex';
export function roofPreset(shape:RoofShape,width=40,length=30,pitch=6):RoofDrawing {
 if(!Number.isFinite(width)||!Number.isFinite(length)||width<=0||length<=0||width>6000||length>6000)throw new Error('Roof width and length must be positive finite values no greater than 6,000 feet');
 if(!Number.isFinite(pitch)||pitch<0||pitch>24)throw new Error('Roof pitch must be between 0 and 24 inches per foot');
 const w=width/2,l=length/2,h=width/2*pitch/12,base=10;
 const point=(x:number,z:number,rise=0):Point=>({x,y:base+rise,z});
 const plane=(name:string,points:Point[],edges:EdgeType[]):RoofPlane=>({id:name,name,points,edges});
 const sw=point(-w,-l),se=point(w,-l),ne=point(w,l),nw=point(-w,l);
 let planes:RoofPlane[]=[];
 if(shape==='flat')planes=[plane('Flat roof',[sw,se,ne,nw],['eave','eave','eave','eave'])];
 else if(shape==='shed')planes=[plane('Shed roof',[sw,se,point(w,l,length*pitch/12),point(-w,l,length*pitch/12)],['eave','rake','eave','rake'])];
 else if(shape==='hip'){
 const a=point(0,-Math.max(0,l-w),Math.min(w,l)*pitch/12),b=point(0,Math.max(0,l-w),Math.min(w,l)*pitch/12);
 if(length===width){const apex=point(0,0,l*pitch/12);planes=[plane('South',[sw,se,apex],['eave','hip','hip']),plane('North',[ne,nw,apex],['eave','hip','hip']),plane('West',[nw,sw,apex],['eave','hip','hip']),plane('East',[se,ne,apex],['eave','hip','hip'])];}
 else if(length<width){const a2=point(-Math.max(0,w-l),0,l*pitch/12),b2=point(Math.max(0,w-l),0,l*pitch/12);planes=[plane('South',[sw,se,b2,a2],['eave','hip','ridge','hip']),plane('North',[nw,a2,b2,ne],['hip','ridge','hip','eave']),plane('West',[sw,a2,nw],['hip','hip','eave']),plane('East',[se,ne,b2],['eave','hip','hip'])];}
 else planes=[plane('West',[sw,a,b,nw],['hip','ridge','hip','eave']),plane('East',[se,ne,b,a],['eave','hip','ridge','hip']),plane('South',[sw,se,a],['eave','hip','hip']),plane('North',[nw,b,ne],['hip','hip','eave'])];
 }else if(shape==='mansard'){
 const inset=Math.min(w,l)*0.3,rise=inset*pitch/12;const a=point(-w+inset,-l+inset,rise),b=point(w-inset,-l+inset,rise),c=point(w-inset,l-inset,rise),d=point(-w+inset,l-inset,rise);
 planes=[plane('South',[sw,se,b,a],['eave','hip','ridge','hip']),plane('East',[se,ne,c,b],['eave','hip','ridge','hip']),plane('North',[ne,nw,d,c],['eave','hip','ridge','hip']),plane('West',[nw,sw,a,d],['eave','hip','ridge','hip']),plane('Upper flat',[a,b,c,d],['ridge','ridge','ridge','ridge'])];
 }else{const a=point(0,-l,h),b=point(0,l,h);planes=[plane('West plane',[sw,a,b,nw],['rake','ridge','rake','eave']),plane('East plane',[a,se,ne,b],['rake','eave','rake','ridge'])];}
 if(shape==='complex'){const wing=roofPreset('hip',width/2,length/2,pitch);planes.push(...wing.planes.map(p=>({...p,id:`wing-${p.id}`,name:`Wing ${p.name}`,points:p.points.map(v=>({...v,x:v.x+width,y:v.y,z:v.z}))})));}
 return {planes,penetrations:[],waste:10,roof_type:'Metal Roof',notes:'',condition:'',verified:false};
}
export function toMaterialReport(d:RoofDrawing){const m=measureDrawing(d);return {roof_type:d.roof_type,area_sqft:m.area,waste_pct:d.waste,ridge_lf:m.edges.ridge,hips_lf:m.edges.hip,valleys_lf:m.edges.valley,eaves_lf:m.edges.eave,rakes_lf:m.edges.rake,panel_width_in:d.metal_panel_width_inches??16,pipes:d.penetrations.filter(p=>p.kind==='pipe'||p.kind==='vent').length};}