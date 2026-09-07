export default {
  name: "verify-acc-51-lists-receipt-and-hold",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-acc-51-lists-receipt-and-hold.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-acc-51-lists-receipt-and-hold.mjs"]);
  },
};
