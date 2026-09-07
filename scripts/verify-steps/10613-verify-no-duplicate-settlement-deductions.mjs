export default {
  name: "verify-no-duplicate-settlement-deductions",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-no-duplicate-settlement-deductions.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-no-duplicate-settlement-deductions.mjs"]);
  },
};
