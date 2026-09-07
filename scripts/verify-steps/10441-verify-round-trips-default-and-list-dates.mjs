export default {
  name: "verify:round-trips-default-and-list-dates",
  run(ctx) {
    ctx.run("node", ["scripts/verify-round-trips-default-and-list-dates.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-round-trips-default-and-list-dates.mjs"]);
  },
};
