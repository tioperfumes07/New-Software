// EXP-DATE wiring (lead, 2026-09-06): scripts/verify-no-future-dated-seed-expenses.mjs was merged in #20917 without a
// step or package.json entry, so verify:guard-wired failed on every PR (locked-guards red on main). The static half
// (correction script uses the real void + POST /api/v1/expenses routes, never a raw UPDATE of transaction_date) runs
// here; the LIVE half runs wherever DATABASE_URL is set and is a no-op-with-hint in CI.
export default {
  name: "verify:no-future-dated-seed-expenses",
  run(ctx) {
    ctx.run("node", ["scripts/verify-no-future-dated-seed-expenses.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-no-future-dated-seed-expenses.mjs"]);
  },
};
