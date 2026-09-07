export default {
  name: "verify:load-costs-register-fetch",
  run(ctx) {
    ctx.run("node", ["scripts/verify-load-costs-register-fetch.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-load-costs-register-fetch.mjs"]);
  },
};
