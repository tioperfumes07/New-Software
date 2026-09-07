export default {
  name: "verify-vendor-statements-activity-tabs",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-vendor-statements-activity-tabs.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-vendor-statements-activity-tabs.mjs"]);
  },
};
