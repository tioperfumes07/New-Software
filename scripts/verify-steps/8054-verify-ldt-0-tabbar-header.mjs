export default {
  name: "verify:ldt-0-tabbar-header",
  run(ctx) {
    ctx.run("node", ["scripts/verify-ldt-0-tabbar-header.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-ldt-0-tabbar-header.mjs"]);
  },
};
