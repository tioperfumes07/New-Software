export default {
  name: "verify-cash-flow-row-adjustments-seq-grant",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-cash-flow-row-adjustments-seq-grant.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-cash-flow-row-adjustments-seq-grant.mjs"]);
  },
};
