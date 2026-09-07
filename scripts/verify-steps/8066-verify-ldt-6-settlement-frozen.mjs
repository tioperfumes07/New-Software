export default {
  name: "verify:ldt-6-settlement-frozen",
  run(ctx) {
    ctx.run("node", ["scripts/verify-ldt-6-settlement-frozen.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-ldt-6-settlement-frozen.mjs"]);
  },
};
