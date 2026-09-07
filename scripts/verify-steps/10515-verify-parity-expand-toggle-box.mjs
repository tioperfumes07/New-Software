export default {
  name: "verify-parity-expand-toggle-box",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-parity-expand-toggle-box.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-parity-expand-toggle-box.mjs"]);
  },
};
