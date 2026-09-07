export default {
  name: "verify-invoice-issue-date-from-load",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-invoice-issue-date-from-load.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-invoice-issue-date-from-load.mjs"]);
  },
};
