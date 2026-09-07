export default {
  name: "verify-dispatch-planner-safety-entitylink",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-dispatch-planner-safety-entitylink.mjs"]);
  },
};
