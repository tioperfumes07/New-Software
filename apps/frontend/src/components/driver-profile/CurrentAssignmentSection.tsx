import { EntityLinkOrTombstone } from "../shared/EntityLinkOrTombstone";

export function CurrentAssignmentSection({
  assignment,
  companyId: _companyId,
  driverId,
  driverName,
  onSetDefault,
}: {
  assignment: Record<string, unknown>;
  /** Kept for caller API stability; unit/load links no longer need opco query params. */
  companyId: string;
  driverId: string;
  /** Canonical name already resolved by the company-scoped profile aggregate. */
  driverName: string | null;
  onSetDefault?: (unitId: string) => void;
}) {
  void _companyId;
  const def = assignment.default_truck as Record<string, unknown> | null;
  const cur = assignment.currently_driving_truck as Record<
    string,
    unknown
  > | null;
  const load = assignment.current_load as Record<string, unknown> | null;

  return (
    <section className="rounded-sm border border-gray-200 bg-white p-4">
      <h2 className="mb-2 text-xs font-semibold text-slate-900">
        Current assignment
      </h2>
      <div className="grid gap-3 text-xs text-slate-700 md:grid-cols-3">
        <div>
          <div className="font-semibold text-slate-800">Default truck</div>
          {def ? (
            <EntityLinkOrTombstone
              kind="unit"
              id={def.unit_id == null ? null : String(def.unit_id)}
              name={def.unit_number}
              noun="Unit"
            />
          ) : (
            <span>—</span>
          )}
        </div>
        <div>
          <div className="font-semibold text-slate-800">Currently driving</div>
          {cur ? (
            <>
              <EntityLinkOrTombstone
                kind="unit"
                id={cur.unit_id == null ? null : String(cur.unit_id)}
                name={cur.unit_number}
                noun="Unit"
                data-testid="driver-profile-current-unit-link"
              />
              {cur.samsara_logged_in_at ? (
                <div className="text-slate-500">
                  Samsara {String(cur.samsara_logged_in_at)}
                </div>
              ) : null}
              {cur.source === "dispatch_load" ? (
                <div className="text-slate-500" data-testid="driver-profile-current-unit-dispatch-source">
                  Current dispatch assignment
                </div>
              ) : null}
            </>
          ) : (
            <span>—</span>
          )}
        </div>
        <div>
          <div className="font-semibold text-slate-800">Current load</div>
          {load ? (
            <>
              <EntityLinkOrTombstone
                kind="load"
                id={load.load_id == null ? null : String(load.load_id)}
                name={load.load_number}
                noun="Load"
              />
              <span> · {String(load.status ?? "—")}</span>
            </>
          ) : (
            <span>—</span>
          )}
        </div>
      </div>
      {onSetDefault ? (
        <p className="mt-2 text-xs text-slate-500">
          Set default truck from fleet unit profile or POST default-truck for
          driver{" "}
          <EntityLinkOrTombstone
            kind="driver"
            id={driverId}
            name={driverName}
            noun="Driver"
          />
        </p>
      ) : null}
    </section>
  );
}
