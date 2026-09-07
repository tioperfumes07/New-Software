export default {
  name: "verify-settlement-detail-reference",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-settlement-detail-reference.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-settlement-detail-reference.mjs"]);
  },
};
