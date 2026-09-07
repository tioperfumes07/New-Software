export default {
  name: "verify-fleet-sample-data-quarantine",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-fleet-sample-data-quarantine.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-fleet-sample-data-quarantine.mjs"]);
  },
};
