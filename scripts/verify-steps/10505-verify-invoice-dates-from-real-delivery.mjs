export default {
  name: "verify-invoice-dates-from-real-delivery",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-invoice-dates-from-real-delivery.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-invoice-dates-from-real-delivery.mjs"]);
  },
};
