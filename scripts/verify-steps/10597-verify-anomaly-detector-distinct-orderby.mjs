export default {
  name: "verify-anomaly-detector-distinct-orderby",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-anomaly-detector-distinct-orderby.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-anomaly-detector-distinct-orderby.mjs"]);
  },
};
