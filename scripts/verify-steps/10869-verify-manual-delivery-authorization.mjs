export default {
  name: "verify-manual-delivery-authorization",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-manual-delivery-authorization.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-manual-delivery-authorization.mjs"]);
  },
};
