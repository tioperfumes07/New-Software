export default {
  name: "verify-source-document-ref-backfill",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-source-document-ref-backfill.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-source-document-ref-backfill.mjs"]);
  },
};
