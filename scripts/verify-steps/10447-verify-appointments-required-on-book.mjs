export default {
  name: "verify-appointments-required-on-book",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-appointments-required-on-book.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-appointments-required-on-book.mjs"]);
  },
};
