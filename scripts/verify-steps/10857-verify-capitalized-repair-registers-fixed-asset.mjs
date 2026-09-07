export default {
  name: "verify-capitalized-repair-registers-fixed-asset",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-capitalized-repair-registers-fixed-asset.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-capitalized-repair-registers-fixed-asset.mjs"]);
  },
};
