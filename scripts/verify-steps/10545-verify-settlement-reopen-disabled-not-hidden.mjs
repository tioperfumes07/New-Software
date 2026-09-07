export default {
  name: "verify-settlement-reopen-disabled-not-hidden",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-settlement-reopen-disabled-not-hidden.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-settlement-reopen-disabled-not-hidden.mjs"]);
  },
};
