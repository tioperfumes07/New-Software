export default {
  name: "verify-reg-parse-data-backfill",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-reg-parse-data-backfill.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-reg-parse-data-backfill.mjs"]);
  },
};
