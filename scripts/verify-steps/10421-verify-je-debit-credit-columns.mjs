export default {
  name: "verify-je-debit-credit-columns",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-je-debit-credit-columns.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-je-debit-credit-columns.mjs"]);
  },
};
