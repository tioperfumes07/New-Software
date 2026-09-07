export default {
  name: "verify-cash-flow-closed-settlement-expected-expense",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-cash-flow-closed-settlement-expected-expense.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-cash-flow-closed-settlement-expected-expense.mjs"]);
  },
};
