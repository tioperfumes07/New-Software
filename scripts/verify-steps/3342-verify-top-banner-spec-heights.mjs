export default {
  name: "verify:top-banner-spec-heights",
  run(ctx) {
    ctx.run("node", ["scripts/verify-top-banner-spec-heights.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-top-banner-spec-heights.mjs"]);
  },
};
