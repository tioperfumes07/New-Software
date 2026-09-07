export default {
  name: "verify-driver-vendor-financial-identity-invariant",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-driver-vendor-financial-identity-invariant.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-driver-vendor-financial-identity-invariant.mjs"]);
  },
};
