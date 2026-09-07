// BANK-DESIGN-1 (lead, 2026-09-06): Banking categorize row = two .ldt-card.strong boxes; match candidates as one
// Date · Description · Type · Amount · Gap register in the Load-costs palette (owner order 2026-09-06).
export default {
  name: "verify:banking-categorize-boxes",
  run(ctx) {
    ctx.run("node", ["scripts/verify-banking-categorize-boxes.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-banking-categorize-boxes.mjs"]);
  },
};
