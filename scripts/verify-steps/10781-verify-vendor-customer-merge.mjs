export default {
  name: "verify-vendor-customer-merge",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-vendor-customer-merge.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-vendor-customer-merge.mjs"]);
  },
};
