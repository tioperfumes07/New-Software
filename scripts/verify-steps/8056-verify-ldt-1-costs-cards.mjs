export default {
  name: "verify:ldt-1-costs-cards",
  run(ctx) {
    ctx.run("node", ["scripts/verify-ldt-1-costs-cards.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-ldt-1-costs-cards.mjs"]);
  },
};
