import { expect, it } from "vitest";
import { calibratedPlane, findSharedEdges, snapToExistingCorner, validateRoofOutline } from "@/lib/roof-trace";
import { planeInfo } from "@/lib/roof-geometry";
it("calibrates a 200 by 100 pixel plane from a 20 foot reference", () => {
  const plane = calibratedPlane(
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ],
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ],
    20,
    0,
    "a",
  );
  expect(planeInfo(plane).area).toBeCloseTo(200);
});
it("calculates sloped area using the supplied 6:12 pitch, not image appearance", () => {
  const plane = calibratedPlane(
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ],
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ],
    20,
    6,
    "a",
  );
  expect(planeInfo(plane).area).toBeCloseTo(200 * Math.sqrt(1.25));
  expect(planeInfo(plane).pitch).toBeCloseTo(6);
});
it("refuses measurements without real calibration", () =>
  expect(() =>
    calibratedPlane(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
      [],
      20,
      0,
      "a",
    ),
  ).toThrow("calibration"));
it("preserves shared image coordinates when separate planes are traced", () => {
  const reference = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
  ];
  const a = calibratedPlane(
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ],
    reference,
    20,
    0,
    "a",
  );
  const b = calibratedPlane(
    [
      { x: 200, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 100 },
      { x: 200, y: 100 },
    ],
    reference,
    20,
    0,
    "b",
  );
  expect(a.points[1]?.x).toBe(20);
  expect(b.points[0]?.x).toBe(20);
  expect(b.points[1]?.x).toBe(40);
});
import { checkCalibration, nextEdgeType } from "@/lib/roof-trace";
it("rises in the chosen uphill direction with the same sloped area", () => {
  const pts = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ],
    ref = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
  const left = calibratedPlane(pts, ref, 20, 6, "l", { uphill: "right" });
  expect(planeInfo(left).area).toBeCloseTo(200 * Math.sqrt(1.25));
  expect(left.points[1]!.y).toBeGreaterThan(left.points[0]!.y);
});
it("keeps edge classifications chosen while tracing", () => {
  const p = calibratedPlane(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    10,
    0,
    "e",
    { edges: ["eave", "rake", "hip"] },
  );
  expect(p.edges).toEqual(["eave", "rake", "hip"]);
});
it("rejects missing or absurd scale and warns on short scale lines", () => {
  expect(checkCalibration([{ x: 0, y: 0 }], 20, 1000).ok).toBe(false);
  expect(
    checkCalibration(
      [
        { x: 0, y: 0 },
        { x: 500, y: 0 },
      ],
      900,
      1000,
    ).ok,
  ).toBe(false);
  const short = checkCalibration(
    [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ],
    20,
    1000,
  );
  expect(short.ok && short.warnings.length > 0).toBe(true);
});
it("cycles edge types", () => {
  expect(nextEdgeType("eave")).toBe("rake");
  expect(nextEdgeType("other")).toBe("eave");
});

it("rejects non-finite or out-of-image calibration points", () => {
  expect(
    checkCalibration(
      [
        { x: 0, y: 0 },
        { x: 1001, y: 0 },
      ],
      20,
      1000,
    ).ok,
  ).toBe(false);
  expect(
    checkCalibration(
      [
        { x: 0, y: 0 },
        { x: Number.NaN, y: 0 },
      ],
      20,
      1000,
    ).ok,
  ).toBe(false);
  expect(
    checkCalibration(
      [
        { x: 0, y: -1 },
        { x: 100, y: 0 },
      ],
      20,
      1000,
    ).ok,
  ).toBe(false);
});
it("rejects invalid traced coordinates and unrealistic reference lengths", () => {
  const ref = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  expect(() =>
    calibratedPlane(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
      ref,
      501,
      0,
      "bad",
    ),
  ).toThrow("500 feet");
  expect(() =>
    calibratedPlane(
      [
        { x: 0, y: 0 },
        { x: Number.NaN, y: 0 },
        { x: 0, y: 100 },
      ],
      ref,
      10,
      0,
      "bad",
    ),
  ).toThrow("coordinates");
});

it("rejects calibration points below the bottom image boundary", () => {
  expect(
    checkCalibration(
      [
        { x: 0, y: 0 },
        { x: 100, y: 701 },
      ],
      20,
      1000,
      700,
    ).ok,
  ).toBe(false);
  expect(
    checkCalibration(
      [
        { x: 0, y: 0 },
        { x: 100, y: 700 },
      ],
      20,
      1000,
      700,
    ).ok,
  ).toBe(true);
});


describe("shared roof corner snapping", () => {
  it("snaps a new plane corner to a nearby previously traced corner", () => {
    const existing = [{ x: 100, y: 200 }, { x: 300, y: 200 }];
    expect(snapToExistingCorner({ x: 106, y: 204 }, existing, 10)).toEqual({ x: 100, y: 200 });
  });

  it("leaves points alone when no existing corner is within tolerance", () => {
    const point = { x: 106, y: 204 };
    expect(snapToExistingCorner(point, [{ x: 300, y: 200 }], 10)).toEqual(point);
  });

  it("ignores invalid existing corners and invalid tolerances", () => {
    const point = { x: 106, y: 204 };
    expect(snapToExistingCorner(point, [{ x: Number.NaN, y: 0 }], 10)).toEqual(point);
    expect(snapToExistingCorner(point, [{ x: 100, y: 200 }], 0)).toEqual(point);
  });
});


describe("roof outline validation", () => {
  it("accepts a normal closed roof outline", () => {
    expect(validateRoofOutline([
      { x: 0, y: 0 }, { x: 200, y: 0 },
      { x: 200, y: 100 }, { x: 0, y: 100 },
    ])).toEqual([]);
  });

  it("rejects adjacent duplicate corners and tiny outlines", () => {
    expect(validateRoofOutline([
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 100 },
    ])).toContain("Two neighboring corners overlap; move or remove the duplicate corner.");
    expect(validateRoofOutline([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 },
    ])).toContain("Roof outline is too small or flat to measure.");
  });

  it("rejects a bow-tie outline that crosses itself", () => {
    expect(validateRoofOutline([
      { x: 0, y: 0 }, { x: 100, y: 100 },
      { x: 0, y: 100 }, { x: 100, y: 0 },
    ])).toContain("Roof outline crosses itself; adjust the corners so the perimeter does not cross.");
  });

  it("prevents invalid outlines from becoming measured roof planes", () => {
    expect(() => calibratedPlane(
      [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }],
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      10, 0, "crossed",
    )).toThrow("crosses itself");
  });
});


describe("shared roof edge detection", () => {
  const left = [
    { x: 0, y: 0 }, { x: 100, y: 0 },
    { x: 100, y: 100 }, { x: 0, y: 100 },
  ];
  it("detects a shared edge traced in the opposite direction", () => {
    const right = [
      { x: 100, y: 0 }, { x: 200, y: 0 },
      { x: 200, y: 100 }, { x: 100, y: 100 },
    ];
    expect(findSharedEdges(left, right, 1)).toEqual([
      { edgeA: 1, edgeB: 3, reversed: true, maxEndpointDistance: 0 },
    ]);
  });

  it("allows small tracing differences within the selected tolerance", () => {
    const adjacent = [
      { x: 101, y: 1 }, { x: 200, y: 0 },
      { x: 200, y: 100 }, { x: 99, y: 101 },
    ];
    expect(findSharedEdges(left, adjacent, 2)).toHaveLength(1);
    expect(findSharedEdges(left, adjacent, 0.5)).toHaveLength(0);
  });

  it("does not report distant or invalid comparisons", () => {
    expect(findSharedEdges(left, [{ x: 300, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 }], 5)).toEqual([]);
    expect(findSharedEdges(left, left, 0)).toEqual([]);
  });
});
