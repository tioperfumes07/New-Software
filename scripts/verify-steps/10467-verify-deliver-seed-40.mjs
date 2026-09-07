export default {
  name: "verify-deliver-seed-40",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-deliver-seed-40.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-deliver-seed-40.mjs"]);
  },
};
