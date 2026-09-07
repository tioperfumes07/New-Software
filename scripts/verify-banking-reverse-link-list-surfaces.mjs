#!/usr/bin/env node
/**
 * Banking reverse_link — leaf-specific Built for surfaces with EntityLink drills.
 * Create-only modals honesty-dropped in required.json (same PR).
 *
 * @matrix-built {"modules":["banking"],"cols":["reverse_link"],"leaves":["transactions.list","transactions.categorize"],"task":"BANK-F5830","vertical":"column-wave"}
 *
 * Self-test: node scripts/verify-banking-reverse-link-list-surfaces.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-banking-reverse-link-list-surfaces";
const VIEW = "apps/frontend/src/pages/banking/components/BankingTransactionsDesignView.tsx";
const HOME = "apps/frontend/src/pages/banking/BankingHome.tsx";
const ROUTES = "apps/frontend/src/routes/manifest.tsx";
const API = "apps/frontend/src/api/banking.ts";
const PLAID = "apps/backend/src/integrations/plaid/link.routes.ts";
const TRANSFERS = "apps/frontend/src/pages/banking/TransfersListPage.tsx";
const PLAID_PANEL = "apps/frontend/src/pages/banking/components/BankingPlaidConnectionsPanel.tsx";
const ACCOUNT_DETAIL = "apps/frontend/src/pages/banking/BankAccountDetail.tsx";
const RECON_WORKSPACE = "apps/frontend/src/pages/banking/ReconciliationWorkspace.tsx";
const LINKED_PANEL = "apps/frontend/src/components/banking/LinkedBankTransactionsPanel.tsx";
const MATCH_DRAWER = "apps/frontend/src/pages/banking/components/MatchDrawer.tsx";
const OBLIGATION_RECON = "apps/frontend/src/pages/banking/BankingObligationReconcilePage.tsx";
const RECON_SUGGESTIONS = "apps/frontend/src/pages/banking/ReconMatchSuggestions.tsx";
const BANK_RECON = "apps/frontend/src/pages/banking/BankReconciliationPage.tsx";
const SPLIT_MODAL = "apps/frontend/src/pages/banking/components/BankTransactionSplitModal.tsx";
const ENTITY_LINK = "apps/frontend/src/components/shared/EntityLink.tsx";
const ITEMS_LIST = "apps/frontend/src/pages/lists/accounting/ItemsListPage.tsx";
const CATEGORIZATION_RULES = "apps/frontend/src/pages/banking/CategorizationRulesPage.tsx";
const RECORD_TRANSFER = "apps/frontend/src/pages/banking/RecordTransferModal.tsx";
const RECORD_CC_PAYMENT = "apps/frontend/src/pages/banking/RecordCCPaymentModal.tsx";
const CATEGORIZATION_ROUTES = "apps/backend/src/banking/categorization.routes.ts";
const RECON_ROUTES = "apps/backend/src/banking/reconciliation.routes.ts";
const MATRIX = "docs/specs/scoreboard/modules/banking.required.json";
const SELF = "scripts/verify-banking-reverse-link-list-surfaces.mjs";
const CLAIMED_LEAVES = ["transactions.list", "transactions.categorize"];

const CHECKS = [
  { name: "exact leaf-specific Built annotation", file: SELF, pattern: /@matrix-built \{"modules":\["banking"\],"cols":\["reverse_link"\],"leaves":\["transactions\.list","transactions\.categorize"\],"task":"BANK-F5830","vertical":"column-wave"\}/ },
  { name: "transactions route mounted", file: ROUTES, pattern: /path="\/banking\/transactions"[\s\S]{0,180}<BankingHomePage initialTab="transactions" \/>/ },
  { name: "transactions view mounted", file: HOME, pattern: /<BankingTransactionsDesignView[\s\S]{0,160}companyId=\{companyId\}/ },
  { name: "categorization reverse read company scoped", file: VIEW, pattern: /getBankTransactionCategorizationLinks\(String\(expandedTxId\), companyId\)/ },
  { name: "persisted linkage panel", file: VIEW, pattern: /data-testid="banking-tx-categorization-links-panel"/ },
  { name: "list driver drill", file: VIEW, pattern: /kind="driver"\s+id=\{tx\.categorization_driver_id\}[\s\S]{0,160}tx\.categorization_driver_name/ },
  { name: "list unit drill", file: VIEW, pattern: /kind="unit"\s+id=\{tx\.categorization_unit_id\}[\s\S]{0,160}tx\.categorization_unit_number/ },
  { name: "list load drill", file: VIEW, pattern: /kind="load"\s+id=\{tx\.resolved_load_id\}/ },
  { name: "list settlement drill", file: VIEW, pattern: /kind="settlement"\s+id=\{tx\.matched_settlement_id\}/ },
  { name: "list bill drill", file: VIEW, pattern: /kind="bill"\s+id=\{tx\.matched_bill_id\}/ },
  { name: "list linkage strip visible for every matched kind", file: VIEW, pattern: /tx\.categorization_load_id \|\|\s+hasPersistedMatch\(tx\) \|\|\s+tx\.categorization_trailer_id/ },
  { name: "list journal entry drill", file: VIEW, pattern: /kind="journal_entry"\s+id=\{tx\.matched_journal_entry_id\}/ },
  { name: "transaction view all-kind match classifier", file: VIEW, pattern: /function hasPersistedMatch\(tx: PlaidBankTransaction\)[\s\S]{0,120}tx\.is_matched[\s\S]{0,500}tx\.matched_expense_id[\s\S]{0,160}tx\.matched_transfer_id[\s\S]{0,160}tx\.matched_journal_entry_id/ },
  { name: "transaction review uses canonical classifier", file: VIEW, pattern: /const looksCategorized =\s+hasPersistedMatch\(tx\)/ },
  { name: "transaction uncategorized uses canonical classifier", file: VIEW, pattern: /return !tx\.matched_kind && !hasPersistedMatch\(tx\)/ },
  { name: "bank transaction transfer id contract", file: API, pattern: /matched_transfer_id\?: string \| null;[\s\S]{0,120}matched_transfer_label\?: string \| null;/ },
  { name: "per-account transfer reverse read", file: PLAID, pattern: /bt\.matched_transfer_id::text AS matched_transfer_id,[\s\S]{0,180}AS matched_transfer_label/ },
  { name: "per-account transfer matched kind", file: PLAID, pattern: /bt\.matched_transfer_id::text AS matched_transfer_id,[\s\S]{0,600}WHEN bt\.matched_transfer_id IS NOT NULL THEN 'transfer'[\s\S]{0,400}END AS matched_kind/ },
  { name: "company transfer reverse read", file: PLAID, pattern: /bt\.matched_transfer_id::text AS matched_transfer_id,[\s\S]{0,180}AS matched_transfer_label[\s\S]{0,1800}WHEN bt\.matched_transfer_id IS NOT NULL THEN 'transfer'/ },
  { name: "company matched load human read", file: PLAID, pattern: /bt\.matched_load_id,\s+matched_load\.load_number AS matched_load_number/ },
  { name: "matched load label join company scoped", file: PLAID, pattern: /LEFT JOIN mdata\.loads matched_load\s+ON matched_load\.id = bt\.matched_load_id\s+AND matched_load\.operating_company_id = bt\.operating_company_id/ },
  { name: "company resolved load pair", file: PLAID, pattern: /COALESCE\(bt\.categorization_load_id, bt\.matched_load_id\)::text AS resolved_load_id,\s+COALESCE\(l\.load_number, matched_load\.load_number\) AS resolved_load_number/ },
  { name: "transfer label join company scoped", file: PLAID, pattern: /LEFT JOIN banking\.transfers transfer\s+ON transfer\.id = bt\.matched_transfer_id\s+AND transfer\.operating_company_id = bt\.operating_company_id/g },
  { name: "list transfer drill", file: VIEW, pattern: /kind="transfer"\s+id=\{tx\.matched_transfer_id\}[\s\S]{0,160}tx\.matched_transfer_label/ },
  { name: "transfer exact deep link read", file: TRANSFERS, pattern: /const deepLinkTransferId = searchParams\.get\("transfer_id"\)[\s\S]{0,5000}getTransfer\(deepLinkTransferId, companyId\)/ },
  // The inline `LEFT JOIN accounting.journal_entries je ... je.operating_company_id = t.operating_
  // company_id` in transfers.service.ts was extracted into a shared, reusable, entity-scoped
  // lookup (apps/backend/src/lib/transfer-tms-je-lookup.ts's attachTransferJournalEntryIds, called
  // from transfers.routes.ts as attachTransferJournalReverse) — both the list and detail readers
  // still call it (2 call sites, same "twice" invariant this check originally asserted via the
  // inline JOIN's duplication), and the lookup itself scopes every query by operating_company_id.
  { name: "transfer readers resolve scoped JE labels", file: "apps/backend/src/banking/transfers.routes.ts", pattern: /attachTransferJournalReverse\([\s\S]{0,1200}attachTransferJournalReverse\(/ },
  { name: "transfer JE lookup helper is entity-scoped", file: "apps/backend/src/lib/transfer-tms-je-lookup.ts", pattern: /jep\.operating_company_id = t\.operating_company_id[\s\S]{0,2000}FROM accounting\.journal_entries\s*\n\s*WHERE operating_company_id = \$1::uuid/ },
  { name: "transfer detail JE reverse drill", file: TRANSFERS, pattern: /detail\.transfer\.journal_entry_id \? \([\s\S]{0,180}kind="journal_entry"[\s\S]{0,180}detail\.transfer\.journal_entry_memo/ },
  { name: "transfer detail bank transaction reverse drill", file: TRANSFERS, pattern: /detail\.transfer\.matched_bank_transaction_id \? \([\s\S]{0,180}kind="bank_transaction"[\s\S]{0,220}detail\.transfer\.matched_bank_transaction_label/ },
  { name: "transfer readers resolve counterparty labels", file: "apps/backend/src/banking/transfers.service.ts", pattern: /counterparty\.code AS counterparty_code[\s\S]*LEFT JOIN org\.companies counterparty[\s\S]{0,100}counterparty\.id = t\.counterparty_company_id[\s\S]*counterparty\.code AS counterparty_code[\s\S]*LEFT JOIN org\.companies counterparty[\s\S]{0,100}counterparty\.id = t\.counterparty_company_id/ },
  { name: "intercompany list uses human counterparty label", file: TRANSFERS, pattern: /row\.intercompany_leg \?\? "group"\} · \{row\.counterparty_code \|\| "Intercompany"\}/ },
  { name: "intercompany group legs exact reverse drill", file: TRANSFERS, pattern: /detail\.legs\.map\(\(leg\)[\s\S]{0,500}kind="transfer" id=\{leg\.id\}[\s\S]{0,180}leg\.reference_number \|\| leg\.memo/ },
  { name: "Plaid connections transfer drill", file: PLAID_PANEL, pattern: /t\.matched_transfer_id \? <EntityLink key="transfer" kind="transfer"[\s\S]{0,180}t\.matched_transfer_label/ },
  { name: "company expense reverse read", file: PLAID, pattern: /bt\.matched_expense_id::text AS matched_expense_id,[\s\S]{0,100}expense\.expense_number AS matched_expense_number/ },
  { name: "both transaction readers expose multi-match contract", file: PLAID, pattern: /ARRAY_REMOVE\(ARRAY\[[\s\S]{0,500}AS matched_kinds[\s\S]*ARRAY_REMOVE\(ARRAY\[[\s\S]{0,500}AS matched_kinds/ },
  { name: "both transaction readers expose canonical matched truth", file: PLAID, pattern: /matched_journal_entry_id IS NOT NULL\) AS is_matched[\s\S]*matched_journal_entry_id IS NOT NULL\) AS is_matched/ },
  { name: "Plaid connections journal entry drill", file: PLAID_PANEL, pattern: /t\.matched_journal_entry_id \? <EntityLink key="je" kind="journal_entry"[\s\S]{0,180}t\.matched_journal_entry_memo/ },
  { name: "Plaid connections expense drill", file: PLAID_PANEL, pattern: /t\.matched_expense_id \? <EntityLink key="expense" kind="expense"[\s\S]{0,180}t\.matched_expense_number/ },
  { name: "Plaid connections renders concurrent matches", file: PLAID_PANEL, pattern: /const links = \[[\s\S]{0,1200}t\.matched_journal_entry_id[\s\S]{0,800}t\.matched_expense_id[\s\S]{0,1000}links\.length/ },
  { name: "register matched expense drill", file: VIEW, pattern: /kind="expense"\s+id=\{tx\.matched_expense_id\}[\s\S]{0,160}tx\.matched_expense_number/ },
  { name: "Plaid connections matched load label", file: PLAID_PANEL, pattern: /t\.matched_load_id \? <EntityLink key="load" kind="load"[\s\S]{0,180}t\.matched_load_number/ },
  { name: "register linked load drills use resolved pair", file: VIEW, pattern: /kind="load"\s+id=\{tx\.resolved_load_id\}\s+label=\{entityLabel\(tx\.resolved_load_number, tx\.resolved_load_id, "Load"\)\}[\s\S]{0,7000}kind="load"\s+id=\{tx\.resolved_load_id\}\s+label=\{entityLabel\(tx\.resolved_load_number, tx\.resolved_load_id, "Load"\)\}/ },
  { name: "bank account register transfer drill", file: ACCOUNT_DETAIL, pattern: /row\.matched_transfer_id \? <EntityLink key="transfer" kind="transfer"[\s\S]{0,180}row\.matched_transfer_label/ },
  { name: "per-account expense reverse read", file: PLAID, pattern: /bt\.matched_expense_id::text AS matched_expense_id,[\s\S]{0,100}expense\.expense_number AS matched_expense_number/ },
  { name: "expense label join company scoped", file: PLAID, pattern: /LEFT JOIN accounting\.expenses expense\s+ON expense\.id = bt\.matched_expense_id\s+AND expense\.operating_company_id = bt\.operating_company_id/ },
  { name: "bank account register expense drill", file: ACCOUNT_DETAIL, pattern: /row\.matched_expense_id \? <EntityLink key="expense" kind="expense"[\s\S]{0,180}row\.matched_expense_number/ },
  { name: "bank account register journal entry drill", file: ACCOUNT_DETAIL, pattern: /row\.matched_journal_entry_id \? <EntityLink key="je" kind="journal_entry"[\s\S]{0,180}row\.matched_journal_entry_memo/ },
  { name: "bank account register renders concurrent matches", file: ACCOUNT_DETAIL, pattern: /function matchedTransactionLinks[\s\S]{0,1600}row\.matched_expense_id[\s\S]{0,800}row\.matched_journal_entry_id[\s\S]{0,800}links\.length/ },
  { name: "reconciliation classifies every persisted match", file: RECON_WORKSPACE, pattern: /function transactionIsMatched\(tx: PlaidBankTransaction\)[\s\S]{0,120}tx\.is_matched[\s\S]{0,500}tx\.matched_transfer_id[\s\S]{0,160}tx\.matched_journal_entry_id/ },
  { name: "reconciliation uses canonical match classifier", file: RECON_WORKSPACE, pattern: /transactionIsMatched\(tx\)[\s\S]*transactionIsMatched\(tx\)[\s\S]*transactionIsMatched\(tx\)[\s\S]*transactionIsMatched\(tx\)/ },
  { name: "reconciliation transfer reverse drill", file: RECON_WORKSPACE, pattern: /kind="transfer" id=\{tx\.matched_transfer_id\}[\s\S]{0,180}tx\.matched_transfer_label/ },
  { name: "reconciliation journal entry reverse drill", file: RECON_WORKSPACE, pattern: /kind="journal_entry" id=\{tx\.matched_journal_entry_id\}[\s\S]{0,180}tx\.matched_journal_entry_memo/ },
  { name: "reconciliation server all-kind partition", file: RECON_ROUTES, pattern: /const hasPersistedMatch = \(row:[\s\S]{0,400}row\.matched_transfer_id \|\| row\.matched_journal_entry_id[\s\S]{0,180}transactions\.filter\(hasPersistedMatch\)[\s\S]{0,180}!hasPersistedMatch\(row\)/ },
  { name: "reconciliation summary all-kind compatibility", file: RECON_ROUTES, pattern: /matched_transfer_id\?: string \| null;[\s\S]{0,100}matched_journal_entry_id\?: string \| null;[\s\S]{0,800}t\.matched_transfer_id \|\| t\.matched_journal_entry_id/ },
  { name: "reconciliation complete reads all match FKs", file: RECON_ROUTES, pattern: /matched_expense_id,\s+matched_transfer_id, matched_journal_entry_id\s+FROM banking\.bank_transactions/ },
  { name: "reconciliation account label read company scoped", file: RECON_ROUTES, pattern: /FROM banking\.bank_accounts\s+WHERE id = \$1::uuid AND operating_company_id = \$2::uuid[\s\S]{0,500}bank_account_label:/ },
  { name: "reconciliation chrome uses resolved account label", file: RECON_WORKSPACE, pattern: /const bankAccountLabel = workspaceQuery\.data\?\.bank_account_label[\s\S]{0,5000}subtitle=\{effectiveBankAccountId \? bankAccountLabel[\s\S]*esc\(bankAccountLabel\)/ },
  { name: "reconciliation candidates resolve business labels", file: RECON_ROUTES, pattern: /TRIM\(load_number\)[\s\S]{0,120}AS display_label[\s\S]*TRIM\(bill_number\)[\s\S]{0,120}AS display_label[\s\S]*TRIM\(display_id\)[\s\S]{0,120}AS display_label/ },
  { name: "reconciliation candidate drills use business labels", file: RECON_WORKSPACE, pattern: /type CandidateEvent =[\s\S]{0,180}display_label: string[\s\S]*kind=\{candidateEntityKind\(event\.event_type\)\}[\s\S]{0,160}entityLabel\(event\.display_label, event\.id/ },
  { name: "reconciliation transactions resolve every matched label", file: RECON_ROUTES, pattern: /load\.load_number AS matched_load_number[\s\S]{0,180}bill\.bill_number AS matched_bill_number[\s\S]{0,180}settlement\.display_id AS matched_settlement_display_id[\s\S]{0,180}expense\.expense_number AS matched_expense_number[\s\S]{0,240}AS matched_transfer_label[\s\S]{0,180}je\.memo AS matched_journal_entry_memo/ },
  { name: "reconciliation matched-label joins are company scoped", file: RECON_ROUTES, pattern: /LEFT JOIN mdata\.loads load[\s\S]{0,140}load\.operating_company_id = bt\.operating_company_id[\s\S]{0,180}LEFT JOIN accounting\.bills bill[\s\S]{0,140}bill\.operating_company_id = bt\.operating_company_id[\s\S]{0,200}LEFT JOIN driver_finance\.driver_settlements settlement[\s\S]{0,160}settlement\.operating_company_id = bt\.operating_company_id[\s\S]{0,200}LEFT JOIN accounting\.expenses expense[\s\S]{0,150}expense\.operating_company_id = bt\.operating_company_id[\s\S]{0,200}LEFT JOIN banking\.transfers transfer[\s\S]{0,150}transfer\.operating_company_id = bt\.operating_company_id[\s\S]{0,200}LEFT JOIN accounting\.journal_entries je[\s\S]{0,140}je\.operating_company_id = bt\.operating_company_id/ },
  { name: "reconciliation row keeps reverse links outside selection button", file: RECON_WORKSPACE, pattern: /<div\s+key=\{tx\.id\}[\s\S]{0,300}<button[\s\S]{0,180}setSelectedTransactionId\(tx\.id\)[\s\S]{0,1200}<\/button>[\s\S]{0,800}<EntityLink/ },
  { name: "linked panel deduction human label projection", file: CATEGORIZATION_ROUTES, pattern: /COALESCE\(NULLIF\(TRIM\(ded\.deduction_type\), ''\), 'Driver deduction'\) AS deduction_label/ },
  { name: "linked panel deduction label join is company scoped", file: CATEGORIZATION_ROUTES, pattern: /LEFT JOIN driver_finance\.driver_settlement_deductions ded[\s\S]{0,180}ded\.operating_company_id = bt\.operating_company_id/ },
  { name: "linked panel deduction exact reverse drill", file: LINKED_PANEL, pattern: /row\.deduction_id \? \([\s\S]{0,300}kind="settlement_deduction"[\s\S]{0,120}id=\{row\.deduction_id\}[\s\S]{0,300}row\.deduction_label/ },
  { name: "match drawer candidate drills use scoped human references", file: MATCH_DRAWER, pattern: /function candidateDrillLabel\(candidate: BankMatchCandidate\)[\s\S]{0,180}candidate\.memo\?\.trim\(\)[\s\S]{0,120}KIND_LABELS\[candidate\.ledger_entry_kind\][\s\S]*kind=\{KIND_ENTITY\[c\.ledger_entry_kind\]\}[\s\S]{0,160}label=\{candidateDrillLabel\(c\)\}/ },
  { name: "obligation reconcile maps every obligation kind to mounted drills", file: OBLIGATION_RECON, pattern: /const OBLIGATION_ENTITY_KIND: Record<ObligationType, EntityKind> = \{[\s\S]{0,300}load: "load"[\s\S]{0,300}settlement: "settlement"[\s\S]{0,300}fuel: "fuel_transaction"[\s\S]{0,300}work_order: "work_order"[\s\S]{0,300}ar_invoice: "invoice"[\s\S]{0,300}bill: "bill"/ },
  { name: "obligation reconcile bank rows drill to exact transactions", file: OBLIGATION_RECON, pattern: /kind="bank_transaction"\s+id=\{row\.id\}[\s\S]{0,220}row\.description\?\.trim\(\)[\s\S]{0,120}row\.merchant_name\?\.trim\(\)/ },
  { name: "obligation reconcile targets drill by scoped label outside buttons", file: OBLIGATION_RECON, pattern: /obligations\.map\(\(o\) => \(\s+<div[\s\S]{0,1200}kind=\{OBLIGATION_ENTITY_KIND\[o\.obligation_type\]\}[\s\S]{0,160}id=\{o\.obligation_id\}[\s\S]{0,160}label=\{o\.label\}/ },
  { name: "obligation reconcile displays both dates through shared formatter", file: OBLIGATION_RECON, pattern: /formatDateUS\(row\.transaction_date\)[\s\S]{0,3000}formatDateUS\(o\.event_date\)/ },
  { name: "reconcile suggestions map every kind to mounted drills", file: RECON_SUGGESTIONS, pattern: /const SUGGESTION_ENTITY_KIND: Record<ReconcileSuggestionType, EntityKind> = \{[\s\S]{0,400}load: "load"[\s\S]{0,400}settlement: "settlement"[\s\S]{0,400}fuel: "fuel_transaction"[\s\S]{0,400}work_order: "work_order"[\s\S]{0,400}ar_invoice: "invoice"[\s\S]{0,400}bill: "bill"[\s\S]{0,400}factoring_batch: "factoring_batch"/ },
  { name: "ordinary reconcile suggestion separates drill from apply", file: RECON_SUGGESTIONS, pattern: /kind=\{SUGGESTION_ENTITY_KIND\[suggestion\.obligation_type\]\}[\s\S]{0,160}id=\{suggestion\.obligation_id\}[\s\S]{0,160}label=\{suggestion\.label\}[\s\S]{0,500}<button[\s\S]{0,300}props\.onAccept/ },
  { name: "factoring reconcile suggestion separates drill from apply", file: RECON_SUGGESTIONS, pattern: /kind="factoring_batch"\s+id=\{props\.suggestion\.obligation_id\}[\s\S]{0,180}props\.suggestion\.batch_number[\s\S]{0,500}<button[\s\S]{0,180}onClick=\{props\.onApply\}/ },
  { name: "bank reconciliation source drill uses scoped human label", file: BANK_RECON, pattern: /kind="bank_transaction"\s+id=\{row\.id\}[\s\S]{0,220}row\.merchant_name\?\.trim\(\)[\s\S]{0,120}row\.description\?\.trim\(\)/ },
  { name: "bank reconciliation selected and variance dates use shared formatter", file: BANK_RECON, pattern: /formatDateUS\(selectedRow\.transaction_date\)[\s\S]{0,6000}formatDateUS\(entry\.entry_date\)/ },
  { name: "split commit contract retains every posted reverse id", file: SPLIT_MODAL, pattern: /driver_advance_id\?: string;[\s\S]{0,160}deduction_id\?: string;[\s\S]{0,160}bill_id\?: string;[\s\S]{0,160}journal_entry_id\?: string;/ },
  { name: "split commit bill uses contextual human drill label", file: SPLIT_MODAL, pattern: /kind="bill" id=\{result\.bill_id\} label=\{`Bill · split line \$\{result\.line_no\}`\}/ },
  { name: "split commit advance exact reverse drill", file: SPLIT_MODAL, pattern: /kind="cash_advance"[\s\S]{0,120}id=\{result\.driver_advance_id\}[\s\S]{0,160}Driver advance · split line/ },
  { name: "split commit deduction exact reverse drill", file: SPLIT_MODAL, pattern: /kind="settlement_deduction"[\s\S]{0,120}id=\{result\.deduction_id\}[\s\S]{0,160}Recovery deduction · split line/ },
  { name: "split commit journal entry exact reverse drill", file: SPLIT_MODAL, pattern: /kind="journal_entry"[\s\S]{0,120}id=\{result\.journal_entry_id\}[\s\S]{0,160}Journal entry · split line/ },
  { name: "record transfer source drill accepts human transaction label", file: RECORD_TRANSFER, pattern: /linkBankTransactionLabel\?: string \| null;[\s\S]*kind="bank_transaction"[\s\S]{0,120}id=\{linkBankTransactionId\}[\s\S]{0,160}linkBankTransactionLabel\?\.trim\(\) \|\| "Bank transaction"/ },
  { name: "credit card payment source drill accepts human transaction label", file: RECORD_CC_PAYMENT, pattern: /linkBankTransactionLabel\?: string \| null;[\s\S]*kind="bank_transaction"[\s\S]{0,120}id=\{linkBankTransactionId\}[\s\S]{0,160}linkBankTransactionLabel\?\.trim\(\) \|\| "Bank transaction"/ },
  { name: "bank register threads source labels into both record creators", file: VIEW, pattern: /<RecordTransferModal[\s\S]{0,600}linkBankTransactionLabel=\{transferModalTx \? transactionLabel\(transferModalTx\) : null\}[\s\S]{0,800}<RecordCCPaymentModal[\s\S]{0,600}linkBankTransactionLabel=\{ccPaymentModalTx \? transactionLabel\(ccPaymentModalTx\) : null\}/ },
  { name: "match drawer source drill accepts human transaction label", file: MATCH_DRAWER, pattern: /bankTransactionLabel\?: string \| null;[\s\S]*kind="bank_transaction"[\s\S]{0,140}id=\{candidatesQuery\.data\?\.bank_transaction_id \?\? bankTransactionId\}[\s\S]{0,160}bankTransactionLabel\?\.trim\(\) \|\| "Bank transaction"/ },
  { name: "bank register threads source label into match drawer", file: VIEW, pattern: /<MatchDrawer[\s\S]{0,160}bankTransactionId=\{matchDrawerTxId\}[\s\S]{0,300}const sourceTransaction = scopedRows\.find\(\(tx\) => tx\.id === matchDrawerTxId\);[\s\S]{0,160}transactionLabel\(sourceTransaction\)/ },
  { name: "categorization deduction exact reverse drill", file: VIEW, pattern: /links\?\.deduction_id \? \([\s\S]{0,300}kind="settlement_deduction"[\s\S]{0,120}id=\{links\.deduction_id\}[\s\S]{0,160}links\.deduction_type\?\.trim\(\) \|\| "Driver deduction"/ },
  { name: "categorization deduction load human projection", file: CATEGORIZATION_ROUTES, pattern: /ded\.load_id::text AS deduction_load_id,\s+deduction_load\.load_number AS deduction_load_number[\s\S]{0,4000}LEFT JOIN mdata\.loads deduction_load\s+ON deduction_load\.id = ded\.load_id\s+AND deduction_load\.operating_company_id = bt\.operating_company_id/ },
  { name: "categorization deduction load exact human drill", file: VIEW, pattern: /kind="load"\s+id=\{links\.deduction_load_id\}[\s\S]{0,180}entityLabel\(links\.deduction_load_number, links\.deduction_load_id, "Load"\)/ },
  { name: "categorization journal entry human projection", file: CATEGORIZATION_ROUTES, pattern: /bt\.matched_journal_entry_id::text AS matched_journal_entry_id,\s+matched_je\.memo AS matched_journal_entry_memo[\s\S]{0,4500}LEFT JOIN accounting\.journal_entries matched_je\s+ON matched_je\.id = bt\.matched_journal_entry_id\s+AND matched_je\.operating_company_id = bt\.operating_company_id/ },
  { name: "categorization journal entry exact human drill", file: VIEW, pattern: /kind="journal_entry"\s+id=\{matchedJournalEntryId\}[\s\S]{0,180}entityLabel\(links\?\.matched_journal_entry_memo, matchedJournalEntryId, "Journal entry"\)/ },
  { name: "catalog item canonical exact route", file: ENTITY_LINK, pattern: /\| "catalog_item"[\s\S]*case "catalog_item":\s+return `\/catalogs\/items\?item_id=\$\{id\}`/ },
  { name: "catalog item deep link exact company-scoped read", file: ITEMS_LIST, pattern: /deepLinkItemId = searchParams\.get\("item_id"\)[\s\S]{0,500}itemsCatalogClient\.get\(String\(deepLinkItemId\), companyId\)[\s\S]{0,700}setSelectedRow\(deepLinkItemQuery\.data\)[\s\S]{0,120}setModalOpen\(true\)/ },
  { name: "categorization item exact human drill", file: VIEW, pattern: /links\?\.item_id \? \([\s\S]{0,260}kind="catalog_item"[\s\S]{0,120}id=\{links\.item_id\}[\s\S]{0,160}entityLabel\(links\.item_name, links\.item_id, "Item"\)/ },
  { name: "categorization rule account exact human drill outside selector", file: CATEGORIZATION_RULES, pattern: /rules\.map\(\(rule\) => \(\s+<div[\s\S]{0,1800}<button[\s\S]{0,900}<\/button>[\s\S]{0,600}kind="account"[\s\S]{0,140}id=\{rule\.coa_account_id\}[\s\S]{0,240}coaLookup\.get\(rule\.coa_account_id\)/ },
  { name: "categorization preview account exact human drill", file: CATEGORIZATION_RULES, pattern: /tx\.coa_account_id \? \([\s\S]{0,240}kind="account"[\s\S]{0,100}id=\{tx\.coa_account_id\}[\s\S]{0,220}tx\.account_number[\s\S]{0,100}tx\.account_name/ },
  { name: "company account join explicitly scoped", file: PLAID, pattern: /JOIN banking\.bank_accounts ba\s+ON ba\.id = bt\.bank_account_id\s+AND ba\.operating_company_id = bt\.operating_company_id/ },
  { name: "categorize driver drill", file: VIEW, pattern: /kind="driver" id=\{links\.driver_id\}[\s\S]{0,120}links\.driver_name/ },
  { name: "categorize unit drill", file: VIEW, pattern: /kind="unit" id=\{links\.unit_id\}[\s\S]{0,120}links\.unit_number/ },
  { name: "categorize load drill", file: VIEW, pattern: /kind="load" id=\{links\.load_id\}[\s\S]{0,120}links\.load_number/ },
  { name: "categorize vendor drill", file: VIEW, pattern: /kind="vendor" id=\{links\.vendor_id\}[\s\S]{0,120}links\.vendor_name/ },
  { name: "categorize customer drill", file: VIEW, pattern: /kind="customer" id=\{links\.customer_id\}[\s\S]{0,120}links\.customer_name/ },
];

function readSources() {
  return Object.fromEntries([...new Set([...CHECKS.map((check) => check.file), MATRIX])].map((file) => [
    file,
    fs.readFileSync(path.join(ROOT, file), "utf8"),
  ]));
}

function run(sources) {
  const fails = CHECKS.filter((check) => !check.pattern.test(sources[check.file])).map((check) => check.name);
  try {
    const matrix = JSON.parse(sources[MATRIX]);
    for (const id of CLAIMED_LEAVES) {
      const leaf = matrix.leaves?.find((item) => item.id === id);
      if (!leaf?.required?.includes("reverse_link")) fails.push(`exact Required ownership: ${id}:reverse_link`);
    }
  } catch {
    fails.push("banking Required matrix parses");
  }
  return fails;
}

if (process.argv.includes("--selftest")) {
  const live = readSources();
  if (run(live).length) {
    console.error(`${LABEL} SELFTEST FAIL live:\n- ${run(live).join("\n- ")}`);
    process.exit(1);
  }
  for (const check of CHECKS) {
    const flags = check.pattern.flags.includes("g") ? check.pattern.flags : `${check.pattern.flags}g`;
    const plantedSource = live[check.file].replace(new RegExp(check.pattern.source, flags), "/* planted banking reverse defect */");
    if (plantedSource === live[check.file] || !run({ ...live, [check.file]: plantedSource }).includes(check.name)) {
      console.error(`${LABEL} SELFTEST FAIL — planted defect stayed green: ${check.name}`);
      process.exit(1);
    }
  }
  for (const id of CLAIMED_LEAVES) {
    const plantedMatrix = live[MATRIX].replace(`"id": "${id}"`, `"id": "${id}.removed"`);
    if (plantedMatrix === live[MATRIX] || !run({ ...live, [MATRIX]: plantedMatrix }).includes(`exact Required ownership: ${id}:reverse_link`)) {
      console.error(`${LABEL} SELFTEST FAIL — exact leaf ownership stayed green: ${id}`);
      process.exit(1);
    }
  }
  const mutationCount = CHECKS.length + CLAIMED_LEAVES.length;
  console.log(`${LABEL} SELFTEST PASS — ${mutationCount}/${mutationCount} planted defects rejected`);
  process.exit(0);
}

const fails = run(readSources());
if (fails.length) {
  console.error(`${LABEL} FAIL:\n- ${fails.join("\n- ")}`);
  process.exit(1);
}
console.log(`${LABEL} PASS — banking reverse_link list surfaces ratcheted`);
