// FAC-08 (owner 2026-09-06: "THE GEAR TO INCLUDE MORE COLUMNS … DRIVER, TRUCK, LOAD AND SETTLEMENT
// NUMBER … MOST OF THE COST COLUMNS FROM LOAD COSTS"). Wires verify-factoring-register-shared-manifest
// into CI: RecoursePipelineTable + ChargebacksTable consume the shared loadCostColumnManifest (one
// manifest, two consumers; no re-authored cost columns), and the backend recourse-pipeline +
// chargebacks-fees routes project the shared load-cost rollup so factoring Costs tie to the
// Load-Costs page for the same load. Claimed number 10596 (cursor EVEN lane).
export default {
  name: "verify-factoring-register-shared-manifest",
  async run(ctx) {
    await ctx.run("node", ["scripts/verify-factoring-register-shared-manifest.mjs", "--selftest"]);
    await ctx.run("node", ["scripts/verify-factoring-register-shared-manifest.mjs"]);
  },
};
