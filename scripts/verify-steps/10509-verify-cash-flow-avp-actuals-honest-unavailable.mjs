export default {
  name: "verify-cash-flow-avp-actuals-honest-unavailable",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-cash-flow-avp-actuals-honest-unavailable.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-cash-flow-avp-actuals-honest-unavailable.mjs"]);
  },
};
