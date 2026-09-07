export default {
  name: "verify-stops-appt-fix-backfill-safe",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-stops-appt-fix-backfill-safe.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-stops-appt-fix-backfill-safe.mjs"]);
  },
};
