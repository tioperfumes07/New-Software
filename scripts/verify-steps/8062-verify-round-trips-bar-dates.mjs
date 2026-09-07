export default {
  name: "verify:round-trips-bar-dates",
  run(ctx) {
    ctx.run("node", ["scripts/verify-round-trips-bar-dates.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-round-trips-bar-dates.mjs"]);
  },
};
