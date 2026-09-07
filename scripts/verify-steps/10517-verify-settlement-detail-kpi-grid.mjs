export default {
  name: "verify-settlement-detail-kpi-grid",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-settlement-detail-kpi-grid.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-settlement-detail-kpi-grid.mjs"]);
  },
};
