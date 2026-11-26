/**
 * Pure permitting rules shared by the CRM UI and tests.
 *
 * Jurisdiction thresholds are configuration, not legal advice. The caller must load
 * the threshold from a verified jurisdiction record; $5,000 is only the requested
 * initial default and must not be treated as universally applicable.
 */
export const DEFAULT_NOC_THRESHOLD_CENTS = 500_000;

export type NoticeOfCommencementResult =
  | { required: true; reason: "value_exceeds_threshold"; thresholdCents: number }
  | { required: false; reason: "value_at_or_below_threshold"; thresholdCents: number }
  | { required: false; reason: "value_unknown"; thresholdCents: number };

export function requiresNoticeOfCommencement(
  contractValueCents: number | null | undefined,
  thresholdCents = DEFAULT_NOC_THRESHOLD_CENTS,
): NoticeOfCommencementResult {
  if (contractValueCents == null) {
    return { required: false, reason: "value_unknown", thresholdCents };
  }
  if (!Number.isSafeInteger(contractValueCents) || contractValueCents < 0) {
    throw new RangeError("Contract value must be a non-negative safe integer in cents");
  }
  if (!Number.isSafeInteger(thresholdCents) || thresholdCents < 0) {
    throw new RangeError("NOC threshold must be a non-negative safe integer in cents");
  }

  return contractValueCents > thresholdCents
    ? { required: true, reason: "value_exceeds_threshold", thresholdCents }
    : { required: false, reason: "value_at_or_below_threshold", thresholdCents };
}
