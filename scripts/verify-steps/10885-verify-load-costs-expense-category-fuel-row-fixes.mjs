export default {
  name: "verify-load-costs-expense-category-fuel-row-fixes",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-load-costs-expense-category-fuel-row-fixes.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-load-costs-expense-category-fuel-row-fixes.mjs"]);
  },
};
