export default {
  name: "verify-banking-toolbar-single-search",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-banking-toolbar-single-search.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-banking-toolbar-single-search.mjs"]);
  },
};
