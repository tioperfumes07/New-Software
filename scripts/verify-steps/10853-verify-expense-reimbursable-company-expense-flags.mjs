export default {
  name: "verify-expense-reimbursable-company-expense-flags",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-expense-reimbursable-company-expense-flags.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-expense-reimbursable-company-expense-flags.mjs"]);
  },
};
