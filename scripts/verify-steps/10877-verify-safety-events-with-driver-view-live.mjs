export default {
  name: "verify-safety-events-with-driver-view-live",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-safety-events-with-driver-view-live.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-safety-events-with-driver-view-live.mjs"]);
  },
};
