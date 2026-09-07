export default {
  name: "verify:load-costs-load-page",
  run(ctx) {
    ctx.run("node", ["scripts/verify-load-costs-load-page.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-load-costs-load-page.mjs"]);
  },
};
