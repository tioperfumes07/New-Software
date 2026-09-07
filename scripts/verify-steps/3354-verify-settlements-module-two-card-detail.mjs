export default {
  name: "verify:settlements-module-two-card-detail",
  run(ctx) {
    ctx.run("node", ["scripts/verify-settlements-module-two-card-detail.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-settlements-module-two-card-detail.mjs"]);
  },
};
