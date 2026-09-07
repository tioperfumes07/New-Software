export default {
  name: "verify-bank-fee-recovery-role-bound",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-bank-fee-recovery-role-bound.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-bank-fee-recovery-role-bound.mjs"]);
  },
};
