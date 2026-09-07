// SET-04 / L.6 (owner CONSOLIDATED 2026-09-06 18:30Z item 7).
// Wires verify-company-settlements-page into CI: /driver-finance/company-settlements renders the
// company-settlement ParityTable + doc-5784 waterfall (Invoiced - Quick Pay - Driver Salary -
// Additional Pay - Fuel - Company Expenses = Net Revenue), fetches the real list + report routes,
// uses the .ldt palette / dash-never-zero, and the route is registered in the manifest.
// Claimed number 10518 (cursor EVEN lane, Rule 25/37).
export default {
  name: "verify-company-settlements-page",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-company-settlements-page.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-company-settlements-page.mjs"]);
  },
};
