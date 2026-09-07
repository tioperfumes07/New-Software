export default {
  name: "verify-one-void-convention",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-one-void-convention.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-one-void-convention.mjs"]);
  },
};
