export default {
  name: "verify-planner-scroll-not-wheel-trapped",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-planner-scroll-not-wheel-trapped.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-planner-scroll-not-wheel-trapped.mjs"]);
  },
};
