export default {
  name: "verify-close-post-a-item2-historical-advances",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-close-post-a-item2-historical-advances.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-close-post-a-item2-historical-advances.mjs"]);
  },
};
