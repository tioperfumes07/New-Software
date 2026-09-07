// ROUND 16.1 (owner 2026-09-06 20:2xZ: "THE LEGS, WHAT IS THAT, THE COLUMNS NEED TO AUTO ADJUST … WE
// CANNOT HAVE A COLUMN OCCUPY ALL SCREEN, BE LOGICAL").
// Wires verify-load-costs-settlement-legs-columns into CI: the /accounting/load-costs Settlement &
// Pre-Settlement tour register (and the /settlements Tours register) render the Legs column as one
// nowrap line of type-colored EntityLink leg pills (count + "+N more" overflow), money cells nowrap
// auto-fit, compact mmmDd dates capped, driver ellipsis, company "not opened" pill; ParityColumn
// gains maxWidth/headerTitle; the backend tour list projects a compact legs[] with load ids.
// Claimed number 10520 (cursor EVEN lane, Rule 25/37).
export default {
  name: "verify-load-costs-settlement-legs-columns",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-load-costs-settlement-legs-columns.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-load-costs-settlement-legs-columns.mjs"]);
  },
};
