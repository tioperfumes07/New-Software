export default {
  name: "verify-settlement-list-accrual",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-settlement-list-accrual.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-settlement-list-accrual.mjs"]);
  },
};
