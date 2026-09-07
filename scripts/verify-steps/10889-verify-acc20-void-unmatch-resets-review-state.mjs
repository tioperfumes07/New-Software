export default {
  name: "verify-acc20-void-unmatch-resets-review-state",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-acc20-void-unmatch-resets-review-state.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-acc20-void-unmatch-resets-review-state.mjs"]);
  },
};
