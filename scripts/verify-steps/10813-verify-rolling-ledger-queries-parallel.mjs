export default {
  name: "verify-rolling-ledger-queries-parallel",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-rolling-ledger-queries-parallel.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-rolling-ledger-queries-parallel.mjs"]);
  },
};
