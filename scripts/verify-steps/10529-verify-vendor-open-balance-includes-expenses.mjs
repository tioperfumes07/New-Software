export default {
  name: "verify-vendor-open-balance-includes-expenses",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-vendor-open-balance-includes-expenses.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-vendor-open-balance-includes-expenses.mjs"]);
  },
};
