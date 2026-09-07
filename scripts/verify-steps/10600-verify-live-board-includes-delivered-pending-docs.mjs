// DSP-BAND-GAP (owner 2026-09-06: "we should have 14-16 trucks ... I only have 10 units in the board").
// Root cause (measured live, RLS-bypassed): 16 InService USMCA trucks exist (14 GPS-active + T122 + T124),
// but the dispatch board showed 10. delivered_pending_docs was in TERMINAL_LOAD_STATUSES, so the LIVE
// board hid those 6 loads (T156/T163/T170/T171/T173/T176) from Booked, while units-without-load treats
// delivered_pending_docs as an ACTIVE load and drops the truck from Awaiting -> those 6 were in NEITHER
// band. Fix: delivered_pending_docs is LIVE (shows in Booked). This step pins both sides in CI.
// Claimed number 10600 (cursor EVEN lane, Rule 25/37).
export default {
  name: "verify-live-board-includes-delivered-pending-docs",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-live-board-includes-delivered-pending-docs.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-live-board-includes-delivered-pending-docs.mjs"]);
  },
};
