// FACT-MIRROR-SYNC (owner 2026-09-06: "how can all invoices for USMCA be 260 and factoring only 19
// advances, that is impossible, 95% of all USMCA invoices are purchased by Faro").
// Root cause (measured live, RLS-bypassed): the "submit to Faro" queue gates on the denormalized
// mdata.customers.factoring_company_vendor_id, populated on 1 of 1,235 customers, while the system of
// record factoring.customer_factor_assignment had 1,221 assigned — so 28 sent, Faro-assigned invoices
// ($76,500) never entered the queue and never got an advance. Fix: assignCustomerToFactor now writes
// the mirror (resolved from the effective canonical agreement, never hardcoded) + a one-time
// idempotent backfill. This step pins the sync in CI.
// Claimed number 10598 (cursor EVEN lane, Rule 25/37).
export default {
  name: "verify-factoring-vendor-mirror-sync",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-factoring-vendor-mirror-sync.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-factoring-vendor-mirror-sync.mjs"]);
  },
};
