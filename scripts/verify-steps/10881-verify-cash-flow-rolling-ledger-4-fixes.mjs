export default {
  name: "verify-cash-flow-rolling-ledger-4-fixes",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-cash-flow-rolling-ledger-4-fixes.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-cash-flow-rolling-ledger-4-fixes.mjs"]);
  },
};
