export default {
  name: "verify-invoice-due-date-from-terms",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-invoice-due-date-from-terms.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-invoice-due-date-from-terms.mjs"]);
  },
};
