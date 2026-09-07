export default {
  name: "verify-open-tour-posts-nothing",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-open-tour-posts-nothing.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-open-tour-posts-nothing.mjs"]);
  },
};
