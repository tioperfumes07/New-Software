export default {
  name: "verify-invoice-copies-export-safe",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-invoice-copies-export-safe.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-invoice-copies-export-safe.mjs"]);
  },
};
