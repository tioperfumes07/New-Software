export default {
  name: "verify-revrec-two-event-posting-contract-documented",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-revrec-two-event-posting-contract-documented.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-revrec-two-event-posting-contract-documented.mjs"]);
  },
};
