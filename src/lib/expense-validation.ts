export const EXPENSE_CATEGORIES = [
  "materials",
  "labor",
  "subcontractors",
  "fuel",
  "equipment",
  "permits",
  "disposal",
  "insurance",
  "advertising",
  "office",
  "other",
] as const;

export type ExpenseInput = {
  description: string;
  category: string;
  amount: number;
  job_id: string;
  incurred_at: string;
  payee: string;
};

export function prepareExpenseRecord(input: ExpenseInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Enter valid expense details");
  }
  const description = input.description.trim();
  const payee = input.payee.trim();
  if (!description || description.length > 250) {
    throw new Error("Expense description must be between 1 and 250 characters");
  }
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new Error("Choose a valid expense category");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Enter an expense amount greater than zero");
  }
  const amount_cents = Math.round(input.amount * 100);
  if (!Number.isSafeInteger(amount_cents) || amount_cents <= 0) {
    throw new Error("Expense amount exceeds the supported range");
  }
  if (
    typeof input.incurred_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.incurred_at) ||
    Number.isNaN(Date.parse(input.incurred_at + "T00:00:00.000Z")) ||
    new Date(input.incurred_at + "T00:00:00.000Z").toISOString().slice(0, 10) !== input.incurred_at
  ) {
    throw new Error("Choose a valid expense date");
  }
  if (payee.length > 180) throw new Error("Supplier / payee must be 180 characters or fewer");
  return {
    description,
    category: input.category,
    amount_cents,
    job_id: input.job_id || null,
    incurred_at: input.incurred_at,
    payee,
  };
}
