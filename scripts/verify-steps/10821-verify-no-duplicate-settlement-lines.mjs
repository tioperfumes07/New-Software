export default {
  name: "verify-no-duplicate-settlement-lines",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-no-duplicate-settlement-lines.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-no-duplicate-settlement-lines.mjs"]);
  },
};
