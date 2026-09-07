export default {
  name: "verify-payrun-close-requires-load-activity",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-payrun-close-requires-load-activity.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-payrun-close-requires-load-activity.mjs"]);
  },
};
