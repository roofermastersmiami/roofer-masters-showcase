export type ProposalMetricInput = {
  id: string;
  is_template: boolean;
  amount: number | null;
  lead_id: string | null;
  created_at: string;
};
export type ProposalShareMetricInput = {
  proposal_id: string;
  signed_at: string | null;
  revoked_at: string | null;
  expires_at: string;
};

export function proposalMetrics(
  proposals: ProposalMetricInput[],
  shares: ProposalShareMetricInput[],
  now = Date.now(),
) {
  if (!Array.isArray(proposals) || !Array.isArray(shares) || !Number.isFinite(now)) {
    throw new Error("Proposal metrics require valid collections and a valid current date");
  }
  const proposalIds = new Set<string>();
  for (const proposal of proposals) {
    if (
      !proposal ||
      typeof proposal !== "object" ||
      typeof proposal.id !== "string" ||
      !proposal.id ||
      typeof proposal.is_template !== "boolean" ||
      (proposal.lead_id !== null && typeof proposal.lead_id !== "string") ||
      (proposal.amount !== null && (!Number.isFinite(proposal.amount) || proposal.amount < 0)) ||
      !Number.isFinite(Date.parse(proposal.created_at))
    ) {
      throw new Error("Proposal metrics contain an invalid proposal");
    }
    if (proposalIds.has(proposal.id))
      throw new Error("Proposal metrics contain duplicate proposal IDs");
    proposalIds.add(proposal.id);
  }
  for (const share of shares) {
    if (
      !share ||
      typeof share !== "object" ||
      typeof share.proposal_id !== "string" ||
      !share.proposal_id ||
      (share.signed_at !== null && !Number.isFinite(Date.parse(share.signed_at))) ||
      (share.revoked_at !== null && !Number.isFinite(Date.parse(share.revoked_at))) ||
      !Number.isFinite(Date.parse(share.expires_at))
    ) {
      throw new Error("Proposal metrics contain an invalid share");
    }
  }
  const actual = proposals.filter((proposal) => !proposal.is_template);
  const sent = actual.filter((proposal) =>
    shares.some((share) => share.proposal_id === proposal.id),
  );
  const accepted = sent.filter((proposal) =>
    shares.some((share) => share.proposal_id === proposal.id && share.signed_at !== null),
  );
  const newestByLead = new Map<string, ProposalMetricInput>();
  for (const proposal of [...actual].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )) {
    if (proposal.lead_id && !newestByLead.has(proposal.lead_id))
      newestByLead.set(proposal.lead_id, proposal);
  }
  const expectedDollars = [...newestByLead.values()]
    .filter(
      (proposal) =>
        shares.some(
          (share) =>
            share.proposal_id === proposal.id &&
            share.signed_at === null &&
            share.revoked_at === null &&
            Date.parse(share.expires_at) > now,
        ) && !accepted.some((signed) => signed.id === proposal.id),
    )
    .reduce((sum, proposal) => sum + (proposal.amount ?? 0), 0);
  const expectedCents = Math.round(expectedDollars * 100);
  if (!Number.isSafeInteger(expectedCents))
    throw new Error("Expected proposal revenue exceeds the supported amount");
  return {
    sent: sent.length,
    accepted: accepted.length,
    acceptance: sent.length ? Math.round((accepted.length / sent.length) * 100) : 0,
    expectedCents,
  };
}
