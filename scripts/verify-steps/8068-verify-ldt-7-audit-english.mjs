export default {
  name: "verify:ldt-7-audit-english",
  run(ctx) {
    ctx.run("node", ["scripts/verify-ldt-7-audit-english.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-ldt-7-audit-english.mjs"]);
  },
};
