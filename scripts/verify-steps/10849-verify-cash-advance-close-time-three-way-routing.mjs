export default {
  name: "verify-cash-advance-close-time-three-way-routing",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-cash-advance-close-time-three-way-routing.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-cash-advance-close-time-three-way-routing.mjs"]);
  },
};
