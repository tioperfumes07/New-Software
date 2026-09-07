export default {
  name: "verify-load-costs-drawer-wide",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-load-costs-drawer-wide.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-load-costs-drawer-wide.mjs"]);
  },
};
