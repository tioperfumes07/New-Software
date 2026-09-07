export default {
  name: "verify-escrow-deduction-alias-retyped",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-escrow-deduction-alias-retyped.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-escrow-deduction-alias-retyped.mjs"]);
  },
};
