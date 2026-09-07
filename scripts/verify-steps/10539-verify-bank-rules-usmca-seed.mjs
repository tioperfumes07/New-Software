// BANK-RULES-USMCA (lead, 2026-09-06): suggestion engine falls back to the raw bank description
// (description_normalized was NULL on all 364 USMCA lines); USMCA rule seed maps only to real accounts
// through POST /api/v1/banking/rules + refresh-suggestion, dry-run by default.
export default {
  name: "verify:bank-rules-usmca-seed",
  run(ctx) {
    ctx.run("node", ["scripts/verify-bank-rules-usmca-seed.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-bank-rules-usmca-seed.mjs"]);
  },
};
