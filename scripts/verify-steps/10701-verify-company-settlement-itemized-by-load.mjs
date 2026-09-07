export default {
  name: "verify-company-settlement-itemized-by-load",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-company-settlement-itemized-by-load.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-company-settlement-itemized-by-load.mjs"]);
  },
};
