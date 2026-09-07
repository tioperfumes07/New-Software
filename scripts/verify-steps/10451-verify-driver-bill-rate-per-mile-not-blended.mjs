export default {
  name: "verify-driver-bill-rate-per-mile-not-blended",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-driver-bill-rate-per-mile-not-blended.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-driver-bill-rate-per-mile-not-blended.mjs"]);
  },
};
