export default {
  name: "verify-load-bookended-settlement-reuse-checks-lines",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-load-bookended-settlement-reuse-checks-lines.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-load-bookended-settlement-reuse-checks-lines.mjs"]);
  },
};
