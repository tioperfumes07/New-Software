export default {
  name: "verify-payment-terms-code-name-collision",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-payment-terms-code-name-collision.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-payment-terms-code-name-collision.mjs"]);
  },
};
