export default {
  name: "verify-settlement-add-deduction-wired",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-settlement-add-deduction-wired.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-settlement-add-deduction-wired.mjs"]);
  },
};
