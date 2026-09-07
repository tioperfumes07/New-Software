export default {
  name: "verify-reimbursement-reversal-routes-to-expense",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-reimbursement-reversal-routes-to-expense.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-reimbursement-reversal-routes-to-expense.mjs"]);
  },
};
