export default {
  name: "verify:load-costs-tour-tabs",
  run(ctx) {
    ctx.run("node", ["scripts/verify-load-costs-tour-tabs.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-load-costs-tour-tabs.mjs"]);
  },
};
