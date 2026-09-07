export default {
  name: "verify-cash-flow-rolling-ledger",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-cash-flow-rolling-ledger.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-cash-flow-rolling-ledger.mjs"]);
  },
};
