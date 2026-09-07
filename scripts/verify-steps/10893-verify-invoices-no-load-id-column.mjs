export default {
  name: "verify-invoices-no-load-id-column",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-invoices-no-load-id-column.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-invoices-no-load-id-column.mjs"]);
  },
};
