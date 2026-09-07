export default {
  name: "verify-broker-advance-never-driver-liability-never-invoice-face",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-broker-advance-never-driver-liability-never-invoice-face.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-broker-advance-never-driver-liability-never-invoice-face.mjs"]);
  },
};
