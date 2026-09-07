export default {
  name: "verify-close-creates-company-settlement",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-close-creates-company-settlement.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-close-creates-company-settlement.mjs"]);
  },
};
