// VC-10 / VC-LIST-02 ("ALL PAGE SIZE", owner CONSOLIDATED 2026-09-06 18:30Z item 2).
// Wires verify-list-page-size-all into CI: the sidebar page-size control on both the vendor and
// customer master-detail lists must offer "All" (ALL_PAGE_SIZE sentinel) and the chosen size must
// persist across reloads (useListPageSizePref). Claimed number 10516 (cursor EVEN lane, Rule 25/37).
export default {
  name: "verify-list-page-size-all",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-list-page-size-all.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-list-page-size-all.mjs"]);
  },
};
