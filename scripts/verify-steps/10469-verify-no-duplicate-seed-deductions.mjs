// DED-DUP wiring (lead, 2026-09-06): scripts/verify-no-duplicate-seed-deductions.mjs was merged in #20917 without a
// step or package.json entry, so verify:guard-wired failed on every PR (locked-guards red on main). The static half
// (correction script uses the REAL voidSettlementDeduction() writer, never raw SQL) runs here; the LIVE half runs
// wherever DATABASE_URL is set (ops, lead audits) and is a no-op-with-hint in CI.
export default {
  name: "verify:no-duplicate-seed-deductions",
  run(ctx) {
    ctx.run("node", ["scripts/verify-no-duplicate-seed-deductions.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-no-duplicate-seed-deductions.mjs"]);
  },
};
