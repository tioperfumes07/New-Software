export default {
  name: "verify:vendors-customers-list-standard",
  run(ctx) {
    ctx.run("node", ["scripts/verify-vendors-customers-list-standard.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-vendors-customers-list-standard.mjs"]);
  },
};
