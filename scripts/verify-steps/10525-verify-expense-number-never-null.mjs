export default {
  name: "verify-expense-number-never-null",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-expense-number-never-null.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-expense-number-never-null.mjs"]);
  },
};
