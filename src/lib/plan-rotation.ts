/**
 * View-only rotation for the workspace's 2D Plan.
 *
 * The plan is drawn in three.js world coordinates (x east, z south on
 * screen, y up). Rotating the plan view applies a rotation about the
 * vertical (Y) axis through the plan centre, using three.js's own
 * rotation-Y convention:
 *
 *   x' = x·cosθ + z·sinθ
 *   z' = −x·sinθ + z·cosθ
 *
 * On screen (right = +x, up = −z) that reads as a standard
 * counter-clockwise rotation for positive angles. The saved drawing,
 * the measurements and the PDF export never see this value — it only
 * changes how the plan is presented so the roof can be squared up
 * with the screen the way the viewer is looking at the house.
 */

/** Step used by the toolbar's rotate buttons. */
export const PLAN_ROTATION_STEP_DEG = 15;

/** Normalize any angle to the (−180, 180] range used for display. */
export function normalizePlanAngleDeg(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * Rotate a plan point (x/z) around a centre by `angleDeg`, matching
 * the three.js `rotation-y` applied to the scene group.
 */
export function rotatePlanPointDeg(
  point: { x: number; z: number },
  center: { x: number; z: number },
  angleDeg: number,
): { x: number; z: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - center.x;
  const dz = point.z - center.z;
  return {
    x: center.x + dx * cos + dz * sin,
    z: center.z - dx * sin + dz * cos,
  };
}

/**
 * Angle of a pointer position relative to a centre, in screen terms
 * matching the plan rotation convention: 0° points right (east),
 * positive angles turn counter-clockwise on screen (toward the top
 * of the screen). Screen y grows downward, hence the negation.
 */
export function pointerAngleDeg(
  center: { x: number; y: number },
  point: { x: number; y: number },
): number {
  return (Math.atan2(-(point.y - center.y), point.x - center.x) * 180) / Math.PI;
}

/**
 * Rotation for a drag in progress: the angle the drag started at,
 * plus however far the pointer has travelled around the centre, so
 * the plan follows the pointer around the screen.
 */
export function dragPlanRotationDeg(
  startRotationDeg: number,
  startPointerDeg: number,
  currentPointerDeg: number,
): number {
  return normalizePlanAngleDeg(startRotationDeg + (currentPointerDeg - startPointerDeg));
}

/**
 * How much wider the plan's framing must be so a rotated plan still
 * fits the viewport: a rectangle rotated by θ needs its extent
 * scaled by |cosθ| + |sinθ| (1 when unrotated, ~1.41 at 45°).
 */
export function planRotationFitFactor(angleDeg: number): number {
  const rad = (angleDeg * Math.PI) / 180;
  return Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad));
}

/**
 * Rotate a screen pixel point around a screen centre, in the same
 * convention as the plan rotation above: screen x grows right and
 * screen y grows DOWN, so mapping (px, py) onto the plan helper's
 * (x, z) makes positive angles turn counter-clockwise on screen —
 * the Sketch Editor's 2D view rotates exactly the way the
 * workspace's 2D Plan does. Rotating by −θ is the exact inverse,
 * which is what pointer → geometry mapping uses.
 */
export function rotateScreenPointDeg(
  point: { px: number; py: number },
  center: { px: number; py: number },
  angleDeg: number,
): { px: number; py: number } {
  const rotated = rotatePlanPointDeg(
    { x: point.px - center.px, z: point.py - center.py },
    { x: 0, z: 0 },
    angleDeg,
  );
  return { px: center.px + rotated.x, py: center.py + rotated.z };
}
