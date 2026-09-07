export default {
  name: "verify:ldt-5-presettlement-readout",
  run(ctx) {
    ctx.run("node", ["scripts/verify-ldt-5-presettlement-readout.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-ldt-5-presettlement-readout.mjs"]);
  },
};
