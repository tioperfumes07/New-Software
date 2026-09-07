export default {
  name: "verify-banking-register-columns",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-banking-register-columns.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-banking-register-columns.mjs"]);
  },
};
