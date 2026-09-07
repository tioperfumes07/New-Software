export default {
  name: "verify-payrun-close-excludes-voided-deductions",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-payrun-close-excludes-voided-deductions.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-payrun-close-excludes-voided-deductions.mjs"]);
  },
};
