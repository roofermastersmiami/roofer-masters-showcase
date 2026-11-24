import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES, prepareExpenseRecord } from "@/lib/expense-validation";

describe("recorded expense validation", () => {
  const valid = {
    description: "  Metal panels  ",
    category: "materials",
    amount: 125.5,
    job_id: "",
    incurred_at: "2026-11-24",
    payee: "  Supplier  ",
  };

  it("normalizes a valid expense and converts dollars to integer cents", () => {
    expect(prepareExpenseRecord(valid)).toEqual({
      description: "Metal panels",
      category: "materials",
      amount_cents: 12550,
      job_id: null,
      incurred_at: "2026-11-24",
      payee: "Supplier",
    });
  });

  it("accepts every supported expense category", () => {
    for (const category of EXPENSE_CATEGORIES) {
      expect(prepareExpenseRecord({ ...valid, category }).category).toBe(category);
    }
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE])(
    "rejects invalid amount %s",
    (amount) => expect(() => prepareExpenseRecord({ ...valid, amount })).toThrow(),
  );

  it.each(["2026-02-30", "not-a-date", ""])("rejects invalid date %s", (incurred_at) => {
    expect(() => prepareExpenseRecord({ ...valid, incurred_at })).toThrow("valid expense date");
  });

  it("rejects invalid categories and oversized descriptions", () => {
    expect(() => prepareExpenseRecord({ ...valid, category: "stripe" })).toThrow(
      "valid expense category",
    );
    expect(() => prepareExpenseRecord({ ...valid, description: "x".repeat(251) })).toThrow(
      "description",
    );
  });
});
