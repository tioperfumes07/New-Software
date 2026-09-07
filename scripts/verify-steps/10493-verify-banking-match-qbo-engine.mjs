// BANK-MATCH-QBO (lead, 2026-09-06): match candidates like QuickBooks Find match — payee-scored suggestions,
// Show / Payee / Date / Amount filters, Payee · Ref no. · Description · Open balance columns, 90/20-day window.
export default {
  name: "verify:banking-match-qbo-engine",
  run(ctx) {
    ctx.run("node", ["scripts/verify-banking-match-qbo-engine.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-banking-match-qbo-engine.mjs"]);
  },
};
