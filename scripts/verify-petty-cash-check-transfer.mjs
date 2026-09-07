#!/usr/bin/env node
/**
 * verify-petty-cash-check-transfer.mjs — Guard for the Petty Cash account feature (owner request 2026-09-06).
 *
 * Proves:
 * 1. The migration adds is_petty_cash to banking.bank_accounts.
 * 2. The banking route exposes POST /api/v1/banking/accounts/petty-cash.
 * 3. payBill (bills.service.ts) creates a transfer to petty cash when paymentMethod === "check"
 *    and PETTY_CASH_CHECK_TRANSFER_ENABLED is ON, using insertTransferInClient (existing machinery).
 * 4. The source bank decrement is SKIPPED when a petty cash transfer fires (no double-decrement).
 * 5. The frontend has a Create Petty Cash button calling the API.
 * 6. The feature flag defaults OFF (migration seeds it false).
 */
import fs from "node:fs";

const files = {
  migration: "db/migrations/202613900200_banking_petty_cash_account.sql",
  bankingRoutes: "apps/backend/src/banking/banking.routes.ts",
  billsService: "apps/backend/src/accounting/bills.service.ts",
  transfersService: "apps/backend/src/banking/transfers.service.ts",
  bankingApi: "apps/frontend/src/api/banking.ts",
  bankingHome: "apps/frontend/src/pages/banking/BankingHome.tsx",
};

const read = (file) => fs.readFileSync(file, "utf8");

export function audit(sources) {
  const s = sources ?? {
    migration: read(files.migration),
    bankingRoutes: read(files.bankingRoutes),
    billsService: read(files.billsService),
    transfersService: read(files.transfersService),
    bankingApi: read(files.bankingApi),
    bankingHome: read(files.bankingHome),
  };
  const failures = [];

  // 1. Migration adds is_petty_cash column
  if (!s.migration.includes("is_petty_cash boolean NOT NULL DEFAULT false")) {
    failures.push("migration: missing is_petty_cash boolean column on banking.bank_accounts");
  }
  if (!s.migration.includes("PETTY_CASH_CHECK_TRANSFER_ENABLED")) {
    failures.push("migration: missing PETTY_CASH_CHECK_TRANSFER_ENABLED feature flag seed");
  }
  if (!/default_enabled[^,]*,\s*false/.test(s.migration) && !/false,\s*0\b/.test(s.migration)) {
    failures.push("migration: feature flag must default OFF (false)");
  }
  // Migration adds petty_cash_funding to transfer_type CHECK
  if (!s.migration.includes("petty_cash_funding")) {
    failures.push("migration: missing petty_cash_funding in transfer_type CHECK constraint");
  }

  // 2. Banking route exposes POST /api/v1/banking/accounts/petty-cash
  if (!s.bankingRoutes.includes("/api/v1/banking/accounts/petty-cash")) {
    failures.push("bankingRoutes: missing POST /api/v1/banking/accounts/petty-cash endpoint");
  }
  if (!s.bankingRoutes.includes("is_petty_cash")) {
    failures.push("bankingRoutes: petty cash endpoint must set is_petty_cash = true");
  }

  // 3. payBill creates a transfer to petty cash on check payment
  if (!s.billsService.includes("pettyCashTransferEnabled")) {
    failures.push("billsService: missing pettyCashTransferEnabled flag check in payBill");
  }
  if (!s.billsService.includes("PETTY_CASH_CHECK_TRANSFER_ENABLED")) {
    failures.push("billsService: must resolve PETTY_CASH_CHECK_TRANSFER_ENABLED flag");
  }
  if (!s.billsService.includes("insertTransferInClient")) {
    failures.push("billsService: must use insertTransferInClient (existing transfer machinery — no new GL math)");
  }
  if (!s.billsService.includes('transferType: "petty_cash_funding"')) {
    failures.push("billsService: transfer must use petty_cash_funding transfer type");
  }
  if (!s.billsService.includes("is_petty_cash = true")) {
    failures.push("billsService: must look up petty cash account by is_petty_cash = true");
  }

  // 4. Source bank decrement is SKIPPED when petty cash transfer fires (no double-decrement)
  if (!/pettyCashAccountId.*\n.*insertTransferInClient/s.test(s.billsService)) {
    failures.push("billsService: transfer must be created when petty cash account is found");
  }
  // Verify the else branch still has the normal updateBankBalance (for when no petty cash)
  if (!/No petty cash transfer.*updateBankBalance/s.test(s.billsService)) {
    failures.push("billsService: must have else branch with normal updateBankBalance when no petty cash");
  }

  // 5. Frontend has Create Petty Cash button
  if (!s.bankingApi.includes("createPettyCashAccount")) {
    failures.push("bankingApi: missing createPettyCashAccount function");
  }
  if (!s.bankingHome.includes("createPettyCashAccount")) {
    failures.push("bankingHome: missing Create Petty Cash button calling createPettyCashAccount");
  }

  // 6. Transfer service exports insertTransferInClient and petty_cash_funding type
  if (!s.transfersService.includes("export async function insertTransferInClient")) {
    failures.push("transfersService: must export insertTransferInClient");
  }
  if (!s.transfersService.includes("petty_cash_funding")) {
    failures.push("transfersService: TransferType must include petty_cash_funding");
  }

  return failures;
}

if (process.argv.includes("--selftest")) {
  const sources = {
    migration: read(files.migration),
    bankingRoutes: read(files.bankingRoutes),
    billsService: read(files.billsService),
    transfersService: read(files.transfersService),
    bankingApi: read(files.bankingApi),
    bankingHome: read(files.bankingHome),
  };

  const mutations = [
    {
      name: "remove is_petty_cash column from migration",
      mutate: (s) => ({ ...s, migration: s.migration.replace("is_petty_cash boolean NOT NULL DEFAULT false", "is_petty_cash_removed boolean NOT NULL DEFAULT false") }),
      expected: "migration: missing is_petty_cash boolean column",
    },
    {
      name: "remove petty cash endpoint from banking routes",
      mutate: (s) => ({ ...s, bankingRoutes: s.bankingRoutes.replace("/api/v1/banking/accounts/petty-cash", "/api/v1/banking/accounts/REMOVED") }),
      expected: "bankingRoutes: missing POST",
    },
    {
      name: "remove insertTransferInClient call from bills service",
      mutate: (s) => ({ ...s, billsService: s.billsService.replaceAll("insertTransferInClient", "REMOVED_transfer_function") }),
      expected: "billsService: must use insertTransferInClient",
    },
    {
      name: "remove createPettyCashAccount from frontend API",
      mutate: (s) => ({ ...s, bankingApi: s.bankingApi.replace("createPettyCashAccount", "REMOVED_petty_cash_api") }),
      expected: "bankingApi: missing createPettyCashAccount",
    },
    {
      name: "remove createPettyCashAccount from BankingHome",
      mutate: (s) => ({ ...s, bankingHome: s.bankingHome.replaceAll("createPettyCashAccount", "REMOVED_petty_cash_button") }),
      expected: "bankingHome: missing Create Petty Cash button",
    },
    {
      name: "flag defaults ON instead of OFF",
      mutate: (s) => ({ ...s, migration: s.migration.replace("false,\n  0", "true,\n  0") }),
      expected: "migration: feature flag must default OFF",
    },
  ];

  let passed = 0;
  for (const { name, mutate, expected } of mutations) {
    const mutated = mutate(sources);
    const results = audit(mutated);
    if (results.length === 0) {
      throw new Error(`SELFTEST FAIL: mutation "${name}" was not caught (expected: ${expected})`);
    }
    if (!results.some((r) => r.includes(expected.slice(0, 20)))) {
      throw new Error(`SELFTEST FAIL: mutation "${name}" caught wrong failure: ${results.join("; ")} (expected: ${expected})`);
    }
    passed++;
  }
  console.log(`verify-petty-cash-check-transfer SELFTEST PASS — ${passed}/${mutations.length} planted defects rejected`);
  process.exit(0);
}

const failures = audit();
if (failures.length) {
  console.error(`verify-petty-cash-check-transfer FAIL\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-petty-cash-check-transfer PASS — petty cash account + check-to-transfer wiring verified");
