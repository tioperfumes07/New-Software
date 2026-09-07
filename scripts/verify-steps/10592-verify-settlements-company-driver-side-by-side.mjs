// ROUND 16.3 (owner 2026-09-06 20:3xZ: "IN SETTLEMENTS I NEED TO HAVE A WINDOW OR TAB … ONE SHOWING
// THE COMPANY SETTLEMENT AND ONE FOR THE DRIVER SETTLEMENTS … HALF SCREEN AND HALF SCREEN SIDE BY
// SIDE.").
// Wires verify-settlements-company-driver-side-by-side into CI: /settlements gets a Company & Driver
// tab (two half-width cards side by side — driver settlement + company settlement waterfall, 50/50 at
// >=1280px, stacked below) reading getTourReadout + getCompanySettlementReport, no raw <table>, PDF via
// openPrintableDocument; plus a Company settlements register tab.
// Claimed number 10592 (cursor EVEN lane, Rule 25/37).
export default {
  name: "verify-settlements-company-driver-side-by-side",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-settlements-company-driver-side-by-side.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-settlements-company-driver-side-by-side.mjs"]);
  },
};
