export default {
  name: "verify-set24-correction-dry-run",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-set24-correction-dry-run.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-set24-correction-dry-run.mjs"]);
  },
};
