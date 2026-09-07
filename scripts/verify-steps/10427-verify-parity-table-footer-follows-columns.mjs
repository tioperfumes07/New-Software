export default {
  name: "verify-parity-table-footer-follows-columns",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-parity-table-footer-follows-columns.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-parity-table-footer-follows-columns.mjs"]);
  },
};
