import { it, expect, describe } from "vitest";
import {
  priceOption,
  actualProfit,
  materialSystem,
  findCatalogPrice,
  catalogForSystem,
  projectInvoices,
  type EstimateOption,
} from "@/lib/advanced-estimate";
const option: EstimateOption = {
  id: "a",
  name: "Metal option",
  system: "Metal Roof",
  lines: [
    {
      id: "a",
      description: "Panels",
      category: "materials",
      quantity: 10,
      unit: "panels",
      unit_cents: 10000,
    },
  ],
  overhead_pct: 10,
  margin_pct: 20,
  discount_cents: 0,
  tax_pct: 10,
  deposit_pct: 30,
};
describe("estimate and recorded profitability", () => {
  it("calculates margin rather than markup and reconciles deposit/balance", () => {
    expect(priceOption(option)).toMatchObject({
      direct: 100000,
      overhead: 10000,
      cost: 110000,
      subtotal: 137500,
      tax: 13750,
      total: 151250,
      deposit: 45375,
      balance: 105875,
    });
  });
  it("rejects discounts above the selling price", () =>
    expect(() => priceOption({ ...option, discount_cents: 200000 })).toThrow("Discount"));
  it("rejects estimate line collections whose aggregate exceeds safe currency precision", () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      id: String(i),
      description: "Roof material",
      category: "materials" as const,
      quantity: 1000000,
      unit: "unit",
      unit_cents: 100000000,
    }));
    expect(() => priceOption({ ...option, lines: many })).toThrow(
      "Direct cost exceeds the supported currency range",
    );
  });
  it("rejects unsafe discounts and selling-price overflow", () => {
    expect(() => priceOption({ ...option, discount_cents: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      "Discount exceeds the supported currency range",
    );
    const largeButValidLines = Array.from({ length: 10 }, (_, i) => ({
      ...option.lines[0],
      id: String(i),
      quantity: 1000000,
      unit_cents: 100000000,
    }));
    expect(() => priceOption({ ...option, margin_pct: 95, lines: largeButValidLines })).toThrow(
      "Selling price exceeds the supported currency range",
    );
  });

  it("separates actual direct costs and recorded overhead", () =>
    expect(
      actualProfit(200000, [
        { category: "materials", amount_cents: 80000 },
        { category: "office", amount_cents: 20000 },
      ]),
    ).toMatchObject({ gross: 120000, net: 100000, margin: 50 }));
  it("does not claim a percentage margin without collected revenue", () =>
    expect(actualProfit(0, [{ category: "labor", amount_cents: 5000 }]).margin).toBeNull());
  it("matches catalog items despite harmless case and whitespace differences", () => {
    const catalog = [
      { system: "Metal Roof", item: "Ridge /  hip cap (10 ft)", unit_cents: 2500 },
      { system: "Tile Roof", item: "Ridge / hip cap (10 ft)", unit_cents: 3000 },
    ];
    expect(
      findCatalogPrice(catalog, "Standing seam", " ridge / HIP cap (10 ft) ")?.unit_cents,
    ).toBe(2500);
    expect(findCatalogPrice(catalog, "Standing seam", "unlisted item")).toBeUndefined();
  });
  it("limits catalog choices to the selected roof system while preserving custom systems", () => {
    const catalog = [
      { system: "Metal Roof", item: "Panels", unit_cents: 1000 },
      { system: "Tile Roof", item: "Tile", unit_cents: 2000 },
      { system: "Coatings", item: "Coating", unit_cents: 3000 },
    ];
    expect(catalogForSystem(catalog, "Standing seam").map((entry) => entry.item)).toEqual([
      "Panels",
    ]);
    expect(catalogForSystem(catalog, "Coatings").map((entry) => entry.item)).toEqual(["Coating"]);
  });
  it("does not import metal quantities for an unsupported coating system", () => {
    expect(materialSystem("Coatings")).toBeNull();
    expect(materialSystem("Standing seam")).toBe("Metal Roof");
  });
  it("attributes invoices only by explicit project allocations", () => {
    const invoices = [{ id: "one" }, { id: "two" }, { id: "unallocated" }],
      links = [
        { invoice_id: "one", job_id: "a" },
        { invoice_id: "two", job_id: "b" },
      ];
    expect(projectInvoices(invoices, links, "a")).toEqual([{ id: "one" }]);
    expect(projectInvoices(invoices, links, "b")).toEqual([{ id: "two" }]);
    expect(projectInvoices(invoices, links, "all")).toHaveLength(3);
  });
});

describe("financial profit calculations", () => {
  it("separates direct costs from business overhead", () => {
    expect(actualProfit(100000, [
      { category: "materials", amount_cents: 25000 },
      { category: "insurance", amount_cents: 5000 },
      { category: "labor", amount_cents: 10000 },
    ])).toEqual({
      direct: 35000,
      overhead: 5000,
      expenses: 40000,
      gross: 65000,
      net: 60000,
      margin: 60,
    });
  });

  it("rejects malformed and unsafe expense amounts", () => {
    expect(() => actualProfit(1000, null as never)).toThrow("valid non-negative integer cents");
    expect(() => actualProfit(-1, [])).toThrow("valid non-negative integer cents");
    expect(() => actualProfit(1000, [{ category: "materials", amount_cents: -1 }])).toThrow(
      "invalid amount or category",
    );
    expect(() => actualProfit(1000, [{ category: "materials", amount_cents: Number.NaN }])).toThrow(
      "invalid amount or category",
    );
  });

  it("rejects totals that exceed safe integer precision", () => {
    expect(() => actualProfit(1000, [
      { category: "materials", amount_cents: Number.MAX_SAFE_INTEGER },
      { category: "labor", amount_cents: 1 },
    ])).toThrow("Direct expenses exceed the supported amount");
  });

  it("returns no margin when no cash has been collected", () => {
    expect(actualProfit(0, [{ category: "materials", amount_cents: 100 }]).margin).toBeNull();
  });
});
