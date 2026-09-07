export default {
  name: "verify-transp-ar-control-opening-balance-integrity",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-transp-ar-control-opening-balance-integrity.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-transp-ar-control-opening-balance-integrity.mjs"]);
  },
};
