export default {
  name: "verify-tour-settlement-company-link",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-tour-settlement-company-link.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-tour-settlement-company-link.mjs"]);
  },
};
