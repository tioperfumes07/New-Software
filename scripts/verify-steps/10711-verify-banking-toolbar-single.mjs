export default {
  name: "verify-banking-toolbar-single",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-banking-toolbar-single.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-banking-toolbar-single.mjs"]);
  },
};
