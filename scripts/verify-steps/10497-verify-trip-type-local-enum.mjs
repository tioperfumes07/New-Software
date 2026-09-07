export default {
  name: "verify-trip-type-local-enum",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-trip-type-local-enum.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-trip-type-local-enum.mjs"]);
  },
};
