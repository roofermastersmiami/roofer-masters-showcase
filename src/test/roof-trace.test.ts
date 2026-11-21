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
});