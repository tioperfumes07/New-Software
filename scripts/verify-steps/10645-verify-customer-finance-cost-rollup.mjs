export default {
  name: "verify-customer-finance-cost-rollup",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-customer-finance-cost-rollup.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-customer-finance-cost-rollup.mjs"]);
  },
};
