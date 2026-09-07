import type React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as safetyApi from "../../../api/safety";
import { ToastProvider } from "../../../components/Toast";
import { FinesPage } from "../FinesPage";

const companyId = "91f6d7d8-0f3a-4c2d-8e1b-2c3d4e5f6071";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // FineCreateModal mounts CreateDriverModal (useNavigate + useToast) unconditionally beside the
  // driver Combobox +Create affordance, so FinesPage needs both a Router and a ToastProvider.
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("FinesPage (A23-9)", () => {
  beforeEach(() => {
    vi.spyOn(safetyApi, "getSafetyFines").mockResolvedValue({
      fines: [
        {
          id: "fine-1",
          issued_date: "2026-06-01",
          subject_type: "driver",
          issued_by_authority: "TX DOT",
          violation_description: "Speeding",
          amount_cents: 15000,
          status: "open",
        },
      ],
      total_count: 1,
    });
    vi.spyOn(safetyApi, "getCompanyViolations").mockResolvedValue({
      company_violations: [
        {
          id: "cv-1",
          reported_date: "2026-05-15",
          violation_type: "DOT_inspection",
          violation_severity: "minor",
          description: "Missing log entry",
          status: "open",
        },
      ],
      total_count: 1,
    });
    vi.spyOn(safetyApi, "createCompanyViolation").mockResolvedValue({ id: "cv-new" });
  });

  it("defaults to driver fines on External Fines tab", async () => {
    render(wrap(<FinesPage operatingCompanyId={companyId} />));
    await waitFor(() => {
      expect(screen.getByText("Speeding")).toBeTruthy();
    });
    const filter = screen.getByTestId("fines-record-type-filter");
    expect(filter.querySelector('[role="combobox"]')).toHaveValue("Driver Fine");
    expect(safetyApi.getSafetyFines).toHaveBeenCalledWith(companyId, expect.any(Object));
  });

  it("surfaces company violations and opens create modal from canonical filter", async () => {
    const user = userEvent.setup();
    render(wrap(<FinesPage operatingCompanyId={companyId} />));
    const recordTypeCombobox = screen.getByTestId("fines-record-type-filter").querySelector('[role="combobox"]') as HTMLElement;
    await user.click(recordTypeCombobox);
    await user.click(screen.getByRole("option", { name: "Company Violation" }));
    await waitFor(() => {
      expect(screen.getByTestId("company-violations-page")).toBeTruthy();
    });
    expect(screen.getByText("Missing log entry")).toBeTruthy();
    expect(safetyApi.getCompanyViolations).toHaveBeenCalledWith(companyId, expect.any(Object));
    await user.click(screen.getByTestId("company-violation-create-btn"));
    expect(screen.getByTestId("company-violation-create-modal")).toBeTruthy();
  });

  // SAFETY-MONEY-FINE-CONVERT-DROPS-DRIVER-LABEL — live-caught 2026-09-07 (USMCA battery,
  // fine-to-liability GL-posting surface's first-ever real exercise): convertFineToLiability's
  // response is a plain `RETURNING *` on safety.civil_fines and carries no subject_driver_name
  // (only the enriched GET list/detail JOIN computes that). Replacing the cached row wholesale with
  // the mutation response therefore dropped the resolved driver name, rendering the governed
  // "Driver — not visible" tombstone even though the driver was fully resolvable. Plants that exact
  // response shape and asserts the driver's real name survives the conversion.
  it("preserves the resolved driver name after Convert to Driver Liability (SAFETY-MONEY-FINE-CONVERT-DROPS-DRIVER-LABEL)", async () => {
    vi.spyOn(safetyApi, "getSafetyFines").mockResolvedValue({
      fines: [
        {
          id: "fine-1",
          issued_date: "2026-06-01",
          subject_type: "driver",
          subject_driver_id: "driver-1",
          subject_driver_name: "Neftali Coronado Urbano",
          issued_by_authority: "DOT",
          violation_description: "Speeding",
          amount_cents: 7500,
          status: "open",
        },
      ],
      total_count: 1,
    });
    // Real backend shape: no subject_driver_name in the mutation response.
    vi.spyOn(safetyApi, "convertFineToLiability").mockResolvedValue({
      fine: {
        id: "fine-1",
        subject_type: "driver",
        subject_driver_id: "driver-1",
        status: "open",
        converted_to_liability_id: "liability-1",
      },
      liability: { id: "liability-1" },
    });

    const user = userEvent.setup();
    render(wrap(<FinesPage operatingCompanyId={companyId} />));
    await waitFor(() => expect(screen.getByText("Speeding")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByTestId("fine-detail-drawer")).toBeTruthy());
    expect(screen.getByText("Neftali Coronado Urbano")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Convert to Driver Liability" }));
    await user.click(screen.getByRole("button", { name: "Confirm conversion" }));

    await waitFor(() => expect(safetyApi.convertFineToLiability).toHaveBeenCalledWith("fine-1", companyId));
    await waitFor(() => expect(screen.getByText("Liability")).toBeTruthy());
    expect(screen.getByText("Neftali Coronado Urbano")).toBeTruthy();
    expect(screen.queryByText("Driver — not visible")).toBeNull();
  });
});
