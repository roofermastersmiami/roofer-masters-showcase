import { expect, it } from 'vitest';
import { calibratedPlane } from '@/lib/roof-trace';
import { planeInfo } from '@/lib/roof-geometry';
it('calibrates a 200 by 100 pixel plane from a 20 foot reference', () => {
  const plane = calibratedPlane([{x:0,y:0},{x:200,y:0},{x:200,y:100},{x:0,y:100}], [{x:0,y:0},{x:200,y:0}],20,0,'a');
  expect(planeInfo(plane).area).toBeCloseTo(200);
});
it('calculates sloped area using the supplied 6:12 pitch, not image appearance', () => {
  const plane = calibratedPlane([{x:0,y:0},{x:200,y:0},{x:200,y:100},{x:0,y:100}], [{x:0,y:0},{x:200,y:0}],20,6,'a');
  expect(planeInfo(plane).area).toBeCloseTo(200*Math.sqrt(1.25));
  expect(planeInfo(plane).pitch).toBeCloseTo(6);
});
it('refuses measurements without real calibration', () => expect(() => calibratedPlane([{x:0,y:0},{x:100,y:0},{x:0,y:100}],[],20,0,'a')).toThrow('calibration'));
it('preserves shared image coordinates when separate planes are traced',()=>{
 const reference=[{x:0,y:0},{x:200,y:0}];
 const a=calibratedPlane([{x:0,y:0},{x:200,y:0},{x:200,y:100},{x:0,y:100}],reference,20,0,'a');
 const b=calibratedPlane([{x:200,y:0},{x:400,y:0},{x:400,y:100},{x:200,y:100}],reference,20,0,'b');
 expect(a.points[1]?.x).toBe(20);expect(b.points[0]?.x).toBe(20);expect(b.points[1]?.x).toBe(40);
});import { checkCalibration, nextEdgeType } from '@/lib/roof-trace';
it('rises in the chosen uphill direction with the same sloped area', () => {
  const pts=[{x:0,y:0},{x:200,y:0},{x:200,y:100},{x:0,y:100}], ref=[{x:0,y:0},{x:200,y:0}];
  const left=calibratedPlane(pts,ref,20,6,'l',{uphill:'right'});
  expect(planeInfo(left).area).toBeCloseTo(200*Math.sqrt(1.25));
  expect(left.points[1]!.y).toBeGreaterThan(left.points[0]!.y);
});
it('keeps edge classifications chosen while tracing', () => {
  const p=calibratedPlane([{x:0,y:0},{x:100,y:0},{x:100,y:100}],[{x:0,y:0},{x:100,y:0}],10,0,'e',{edges:['eave','rake','hip']});
  expect(p.edges).toEqual(['eave','rake','hip']);
});
it('rejects missing or absurd scale and warns on short scale lines', () => {
  expect(checkCalibration([{x:0,y:0}],20,1000).ok).toBe(false);
  expect(checkCalibration([{x:0,y:0},{x:500,y:0}],900,1000).ok).toBe(false);
  const short=checkCalibration([{x:0,y:0},{x:30,y:0}],20,1000);
  expect(short.ok && short.warnings.length>0).toBe(true);
});
it('cycles edge types', () => { expect(nextEdgeType('eave')).toBe('rake'); expect(nextEdgeType('other')).toBe('eave'); });
