
import { describe, it, expect } from "vitest";

import {
  degreesToPitchRise,
  pitchRiseToDegrees,
  squareMetersToSquareFeet,
  squareFeetToSquares,
  projectedAreaToSurfaceArea,
  polygonAreaSqFt,
  calculateRoofSummary,
} from "../lib/roof-calculations";

describe("Roof calculation helpers", () => {
  it("converts pitch degrees to rise per 12", () => {
    expect(degreesToPitchRise(45)).toBeCloseTo(12);
  });

  it("converts pitch rise to degrees", () => {
    expect(pitchRiseToDegrees(12)).toBeCloseTo(45);
  });

  it("converts square meters to square feet", () => {
    expect(squareMetersToSquareFeet(1)).toBeCloseTo(10.7639, 3);
  });

  it("converts square feet to roofing squares", () => {
    expect(squareFeetToSquares(1000)).toBe(10);
  });

  it("calculates sloped area from projected area", () => {
    expect(
      projectedAreaToSurfaceArea(100, 12)
    ).toBeCloseTo(141.421356);
  });

  it("does not apply pitch twice to surface area", () => {
    const result = calculateRoofSummary({
      facets: [
        {
          id: "plane-1",
          surfaceAreaSqFt: 1000,
          pitchRisePer12: 12,
        },
      ],
      wastePercent: 0,
    });

    expect(result.facetSurfaceAreaSqFt).toBe(1000);
  });

  it("calculates waste and rounds order squares up", () => {
    const result = calculateRoofSummary({
      facets: [
        {
          id: "plane-1",
          surfaceAreaSqFt: 1000,
        },
      ],
      wastePercent: 10,
    });

    expect(result.wasteAreaSqFt).toBe(100);
    expect(result.totalAreaWithWasteSqFt).toBe(1100);
    expect(result.orderSquares).toBe(11);
  });

  it("counts shared edges only once", () => {
    const result = calculateRoofSummary({
      facets: [
        { id: "a", surfaceAreaSqFt: 500 },
        { id: "b", surfaceAreaSqFt: 500 },
      ],
      edges: [
        { id: "shared-1", type: "ridge", lengthFt: 20 },
        { id: "shared-1", type: "ridge", lengthFt: 20 },
      ],
    });

    expect(result.linearFeet.ridge).toBe(20);
    expect(result.totalUniqueEdgeFeet).toBe(20);
  });

  it("rejects conflicting shared edge measurements", () => {
    expect(() =>
      calculateRoofSummary({
        facets: [
          { id: "a", surfaceAreaSqFt: 500 },
        ],
        edges: [
          { id: "shared-1", type: "ridge", lengthFt: 20 },
          { id: "shared-1", type: "hip", lengthFt: 25 },
        ],
      })
    ).toThrow();
  });

  it("calculates polygon area", () => {
    expect(
      polygonAreaSqFt([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ])
    ).toBe(100);
  });

  it("rejects duplicate roof facet ids", () => {
    expect(() =>
      calculateRoofSummary({
        facets: [
          { id: "plane-1", surfaceAreaSqFt: 500 },
          { id: "plane-1", surfaceAreaSqFt: 500 },
        ],
      })
    ).toThrow("Duplicate roof facet id");
  });

  it("rejects empty roof facet and edge ids", () => {
    expect(() =>
      calculateRoofSummary({
        facets: [{ id: " ", surfaceAreaSqFt: 500 }],
      })
    ).toThrow("non-empty id");

    expect(() =>
      calculateRoofSummary({
        facets: [{ id: "plane-1", surfaceAreaSqFt: 500 }],
        edges: [{ id: "", type: "ridge", lengthFt: 10 }],
      })
    ).toThrow("non-empty id");
  });

  it("rejects area totals that overflow finite numeric range", () => {
    expect(() =>
      calculateRoofSummary({
        facets: [
          { id: "plane-1", surfaceAreaSqFt: Number.MAX_VALUE },
          { id: "plane-2", surfaceAreaSqFt: Number.MAX_VALUE },
        ],
      })
    ).toThrow("supported range");
  });

  it("rejects ambiguous area inputs", () => {
    expect(() =>
      calculateRoofSummary({
        facets: [
          {
            id: "plane-1",
            surfaceAreaSqFt: 1000,
            projectedAreaSqFt: 900,
          },
        ],
      })
    ).toThrow();
  });

  it("rejects invalid waste percentages", () => {
    expect(() =>
      calculateRoofSummary({
        facets: [
          { id: "plane-1", surfaceAreaSqFt: 1000 },
        ],
        wastePercent: 60,
      })
    ).toThrow();
  });
  it("rejects geometry conversions and polygon calculations that overflow", () => {
    expect(() => squareMetersToSquareFeet(Number.MAX_VALUE)).toThrow("supported range");
    expect(() => projectedAreaToSurfaceArea(Number.MAX_VALUE, 12)).toThrow("supported range");
    expect(() => polygonAreaSqFt([
      { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
      { x: -Number.MAX_VALUE, y: Number.MAX_VALUE },
      { x: 0, y: -Number.MAX_VALUE },
    ])).toThrow("supported range");
  });

  it("rejects unsupported edge types and overflowing total edge length", () => {
    expect(() => calculateRoofSummary({
      facets: [{ id: "plane-1", surfaceAreaSqFt: 100 }],
      edges: [{ id: "bad", type: "toString" as never, lengthFt: 10 }],
    })).toThrow("unsupported type");

    expect(() => calculateRoofSummary({
      facets: [{ id: "plane-1", surfaceAreaSqFt: 100 }],
      edges: [
        { id: "edge-1", type: "ridge", lengthFt: Number.MAX_VALUE },
        { id: "edge-2", type: "ridge", lengthFt: Number.MAX_VALUE },
      ],
    })).toThrow("supported range");
  });

  it("rejects malformed roof edge collections",()=>{
    expect(()=>calculateRoofSummary({facets:[{id:"plane-1",surfaceAreaSqFt:100}],edges:{} as never})).toThrow("edges must be provided as an array");
  });

});
