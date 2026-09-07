// CLAIM-HELPER-01 (lead, 2026-09-06): every seat claims verify-step numbers through
// scripts/claim-verify-step.mjs (reads origin/main + local, per-seat stagger inside the lane band,
// textual registry append). Ends the same-minute collisions of 10517/10521, 10533, 10541/10545.
export default {
  name: "verify:claim-helper-stagger",
  run(ctx) {
    ctx.run("node", ["scripts/claim-verify-step.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-claim-helper-stagger.mjs", "--selftest"]);
    ctx.run("node", ["scripts/verify-claim-helper-stagger.mjs"]);
  },
};
