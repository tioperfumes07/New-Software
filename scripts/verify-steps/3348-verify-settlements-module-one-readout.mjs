export default {
  name: "verify:settlements-module-one-readout",
  run(ctx) {
    ctx.run("node", ["scripts/verify-settlements-module-one-readout.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-settlements-module-one-readout.mjs"]);
  },
};
