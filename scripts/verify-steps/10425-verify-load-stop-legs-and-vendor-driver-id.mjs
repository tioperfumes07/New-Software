export default {
  name: "verify-load-stop-legs-and-vendor-driver-id",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-load-stop-legs-and-vendor-driver-id.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-load-stop-legs-and-vendor-driver-id.mjs"]);
  },
};
