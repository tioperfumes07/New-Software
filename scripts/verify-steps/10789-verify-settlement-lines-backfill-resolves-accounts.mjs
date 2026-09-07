export default {
  name: "verify-settlement-lines-backfill-resolves-accounts",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-settlement-lines-backfill-resolves-accounts.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-settlement-lines-backfill-resolves-accounts.mjs"]);
  },
};
