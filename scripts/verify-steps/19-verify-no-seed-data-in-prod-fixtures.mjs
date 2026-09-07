export default {
  name: "verify-no-seed-data-in-prod-fixtures",
  run: async (ctx) => {
    if (ctx.run("node", ["scripts/verify-no-seed-data-in-prod-fixtures.mjs", "--selftest"]) !== 0) {
      process.exit(1);
    }
    if (ctx.run("npm", ["run", "verify:no-seed-data-in-prod-fixtures"]) !== 0) {
      process.exit(1);
    }
  },
};
