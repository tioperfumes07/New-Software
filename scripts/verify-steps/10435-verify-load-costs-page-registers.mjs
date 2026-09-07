export default {
  name: "verify-load-costs-page-registers",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-load-costs-page-registers.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-load-costs-page-registers.mjs"]);
  },
};
