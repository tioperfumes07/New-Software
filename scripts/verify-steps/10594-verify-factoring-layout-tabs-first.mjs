// FAC-07 (owner 2026-09-06 22:3xZ: "THE FACTORING PROFILE OCCUPIES THE ENTIRE SCREEN … TABS ROW
// SHOULD BE ON TOP"). Wires verify-factoring-layout-tabs-first into CI: FactoringHome renders the
// navy tab strip FIRST (Banking-Home shape), then a 12-col overview row — DrillKpiCard tiles left
// 7/12, the COMPACT FactoringProfilePanel (≤220px, EntityLink to the vendor) right 5/12 — with the
// duplicate-vendor banner between the tabs and the row. Claimed number 10594 (cursor EVEN lane).
export default {
  name: "verify-factoring-layout-tabs-first",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-factoring-layout-tabs-first.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-factoring-layout-tabs-first.mjs"]);
  },
};
