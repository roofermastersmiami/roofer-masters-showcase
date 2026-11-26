/**
 * Pure permitting rules shared by the CRM UI and tests.
 *
 * Jurisdiction thresholds are configuration, not legal advice. The caller must load
 * the threshold from a verified jurisdiction record; $5,000 is only the requested
 * initial default and must not be treated as universally applicable.
 */
export const DEFAULT_NOC_THRESHOLD_CENTS = 500_000;

/** Existing job creation stores 0 cents when no accepted proposal supplied a budget. */
export function getRecordedBudgetForNocScreening(
  budgetCents: number | null | undefined,
): number | null {
  return budgetCents == null || budgetCents === 0 ? null : budgetCents;
}

export type NoticeOfCommencementResult =
  | { required: true; reason: "value_exceeds_threshold"; thresholdCents: number }
  | { required: false; reason: "value_at_or_below_threshold"; thresholdCents: number }
  | { required: false; reason: "value_unknown"; thresholdCents: number };

export function requiresNoticeOfCommencement(
  contractValueCents: number | null | undefined,
  thresholdCents = DEFAULT_NOC_THRESHOLD_CENTS,
): NoticeOfCommencementResult {
  if (!Number.isSafeInteger(thresholdCents) || thresholdCents < 0) {
    throw new RangeError("NOC threshold must be a non-negative safe integer in cents");
  }
  if (contractValueCents == null) {
    return { required: false, reason: "value_unknown", thresholdCents };
  }
  if (!Number.isSafeInteger(contractValueCents) || contractValueCents < 0) {
    throw new RangeError("Contract value must be a non-negative safe integer in cents");
  }

  return contractValueCents > thresholdCents
    ? { required: true, reason: "value_exceeds_threshold", thresholdCents }
    : { required: false, reason: "value_at_or_below_threshold", thresholdCents };
}

export type PermitApplicationStatus =
  | "draft" | "ready_to_submit" | "submitted" | "issued" | "rejected" | "expired" | "cancelled";
export type PermitInspectionStatus = "requested" | "scheduled" | "passed" | "failed" | "cancelled";

const permitTransitions: Record<PermitApplicationStatus, readonly PermitApplicationStatus[]> = {
  draft: ["ready_to_submit", "cancelled"],
  ready_to_submit: ["submitted", "cancelled"],
  submitted: ["issued", "rejected", "cancelled"],
  issued: ["expired"],
  rejected: [],
  expired: [],
  cancelled: [],
};

const inspectionTransitions: Record<PermitInspectionStatus, readonly PermitInspectionStatus[]> = {
  requested: ["scheduled", "cancelled"],
  scheduled: ["passed", "failed", "cancelled"],
  passed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionPermitApplication(
  current: PermitApplicationStatus,
  next: PermitApplicationStatus,
): boolean {
  return current === next || permitTransitions[current].includes(next);
}

export function canTransitionPermitInspection(
  current: PermitInspectionStatus,
  next: PermitInspectionStatus,
): boolean {
  return current === next || inspectionTransitions[current].includes(next);
}

/** New permit applications must begin in the draft state. */
export function canCreatePermitApplication(status: PermitApplicationStatus): boolean {
  return status === "draft";
}

/** New inspections must begin as requested; outcomes require a confirmed appointment. */
export function canCreatePermitInspection(status: PermitInspectionStatus): boolean {
  return status === "requested";
}
