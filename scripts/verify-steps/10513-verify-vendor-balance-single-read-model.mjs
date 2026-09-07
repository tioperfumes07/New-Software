export default {
  name: "verify-vendor-balance-single-read-model",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-vendor-balance-single-read-model.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-vendor-balance-single-read-model.mjs"]);
  },
};
