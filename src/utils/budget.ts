// src/utils/budget.ts
import type { BudgetCycle, CustomAccount, DebtRecord, ExpenseRecord, TransferRecord } from '../types';
import { convertToALL } from './currency';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseLocalDate(value: string): Date {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function toDateInputValue(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

export function daysBetween(start: Date, end: Date): number {
    const startMs = startOfDay(start).getTime();
    const endMs = startOfDay(end).getTime();
    return Math.round((endMs - startMs) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type ExpenseBucket =
    | 'reconciliation'
    | 'debtSettlement'
    | 'debtOrigin'
    | 'forgiveness'
    | 'travel'   // legacy bucket name; UI calls it "Dreams"
    | 'big'
    | 'noWalletSpending'
    | 'regular';

export function isReconciliationEntry(e: ExpenseRecord): boolean {
    return (e.itemName ?? '').trim().toLowerCase() === 'balance reconciliation';
}

export function classifyExpense(e: ExpenseRecord): ExpenseBucket {
    if (isReconciliationEntry(e)) return 'reconciliation';
    if (e.isDebtOrigin) return 'debtOrigin';
    if (e.debtRelated) return 'debtSettlement';
    if (e.walletNeutral && (e.itemName ?? '').trim().startsWith('Offset from ')) return 'debtSettlement';
    if (e.isForgiveness) return 'forgiveness';
    if (e.category === 'Travel') return 'travel';
    if (e.isBigExpense) return 'big';
    if (e.walletNeutral) return 'noWalletSpending';
    return 'regular';
}

export function budgetImpactOf(e: ExpenseRecord): number {
    return e.budgetAmountALL ?? e.amountInALL;
}

export function cycleStartMs(cycle: BudgetCycle): number {
    return parseLocalDate(cycle.startDate).getTime();
}

/**
 * Where do earmarked buckets physically live?
 * true = they're earmarks on money that's already inside walletTotal.
 * This is the model we use: Dreams/Savings/Investments are inside the wallet,
 * held back from free-to-spend, NOT added again to net worth.
 */
export const EARMARKS_INSIDE_WALLET = true;

// ---------------------------------------------------------------------------
// Divvy snapshot
// ---------------------------------------------------------------------------

export interface DivvySnapshot {
    receivablesALL: number;
    payablesALL: number;
    walletDeltaALL?: number;
    walletCardDeltaALL?: number;
    walletCashDeltaALL?: number;
    regularBudgetSpendALL?: number;
    bigExpenseSpendALL?: number;
    travelSpendALL?: number;
    virtualExpenses?: ExpenseRecord[];
    rollup?: unknown;
}

export const EMPTY_DIVVY_SNAPSHOT: DivvySnapshot = {
    receivablesALL: 0,
    payablesALL: 0,
};

export function snapshotFromGroups(
    groups: Array<{ myNetBalanceALL?: number }> | undefined | null
): DivvySnapshot {
    if (!groups || groups.length === 0) return EMPTY_DIVVY_SNAPSHOT;
    let rec = 0;
    let pay = 0;
    for (const g of groups) {
        const net = g.myNetBalanceALL ?? 0;
        if (net > 0) rec += net;
        else if (net < 0) pay += -net;
    }
    return { receivablesALL: rec, payablesALL: pay };
}

// ---------------------------------------------------------------------------
// Aux account helpers
// ---------------------------------------------------------------------------

/**
 * Convert a custom account's native balance to ALL using the app's static
 * EXCHANGE_RATES table. Good enough for daily display; not for real FX
 * settlement. If the account currency isn't in the table, treat it as ALL
 * (safer than silently multiplying by 1 for a foreign currency).
 */
export function customAccountBalanceALL(acc: CustomAccount): number {
    try {
        return convertToALL(acc.nativeBalance, acc.currency as any);
    } catch {
        return acc.nativeBalance;
    }
}

export function totalAuxAccountsALL(accounts: CustomAccount[] | undefined | null): number {
    if (!accounts || accounts.length === 0) return 0;
    return accounts.reduce((sum, acc) => sum + customAccountBalanceALL(acc), 0);
}

// ---------------------------------------------------------------------------
// BudgetStats
// ---------------------------------------------------------------------------

export interface BudgetStats {
    cycleBudget: number;
    consumed: number;
    forgivenSpent: number;
    remaining: number;
    percentConsumed: number;

    plannedBig: number;
    bigExpenseSpent: number;
    unpaidBig: number;

    // Earmarks (held back from free-to-spend)
    dreamsHeld: number;
    savingsHeld: number;
    investmentsHeld: number;
    totalEarmarked: number;

    freeToSpend: number;

    // Bucket balances
    dreamsBalance: number;        // legacy field `travelStashALL` minus spent on Travel
    savingsBalance: number;       // `savingsALL` (no per-expense drawdown yet)
    investmentsBalance: number;   // `investmentsALL`

    dreamsSpent: number;          // spending from Dreams this cycle

    totalDays: number;
    daysLeft: number;
    dayNumber: number;
    isPaydayReached: boolean;
    dailyAllowance: number;
    consumedToday: number;
    leftToday: number;
    bufferPool: number;

    // Wallet side
    estimatedBankBalance: number;
    estimatedCashBalance: number;
    auxAccountsTotal: number;
    walletTotal: number;

    // Debts
    receivablesALL: number;
    payablesALL: number;
    divvyReceivablesALL: number;
    divvyPayablesALL: number;
    netOfDebtsALL: number;
    netWorthALL: number;

    spent: number;
    spentToday: number;
    estimatedTotalBalance: number;
    projectedSurplus: number;

    // Legacy aliases (kept so old code that reads these names still works)
    travelStashBalance: number;
    travelStashHeld: number;
    travelSpent: number;
}

export function computeBudgetStats(
    cycle: BudgetCycle,
    expenses: ExpenseRecord[],
    transfers: TransferRecord[] = [],
    debts: DebtRecord[] = [],
    divvy: DivvySnapshot = EMPTY_DIVVY_SNAPSHOT,
    now: Date = new Date()
): BudgetStats {
    const start = parseLocalDate(cycle.startDate);
    const end = parseLocalDate(cycle.targetEndDate);
    const today = startOfDay(now);
    const startMs = start.getTime();
    const todayMs = today.getTime();

    const totalDays = Math.max(1, daysBetween(start, end));
    const rawDaysLeft = daysBetween(today, end);
    const isPaydayReached = rawDaysLeft <= 0;
    const daysLeft = Math.max(1, rawDaysLeft);
    const daysElapsed = Math.min(totalDays, Math.max(0, daysBetween(start, today)));
    const dayNumber = Math.min(totalDays, daysElapsed + 1);

    let consumed = 0;
    let forgivenSpent = 0;
    let bigExpenseSpent = 0;
    let dreamsSpent = 0;
    let consumedToday = 0;
    let consumedBeforeToday = 0;

    let cashDelta = 0;
    let cardDelta = 0;

    const localExpenseIds = new Set<string>();

    const accumulateExpense = (e: ExpenseRecord) => {
        if (e.deleted) return;
        const whenMs = new Date(e.timestamp).getTime();
        if (whenMs < startMs) return;

        if (!e.walletNeutral) {
            const amt = e.amountInALL;
            if (e.paidWith === 'Cash') cashDelta -= amt;
            else cardDelta -= amt;
        }

        const bucket = classifyExpense(e);
        const budgetImpact = budgetImpactOf(e);

        switch (bucket) {
            case 'reconciliation':
            case 'debtSettlement':
            case 'debtOrigin':
                break;

            case 'travel': // Dreams
                dreamsSpent += budgetImpact;
                break;

            case 'big':
                bigExpenseSpent += budgetImpact;
                break;

            case 'forgiveness':
                consumed += budgetImpact;
                forgivenSpent += budgetImpact;
                if (whenMs >= todayMs) consumedToday += budgetImpact;
                else consumedBeforeToday += budgetImpact;
                break;

            case 'regular':
            case 'noWalletSpending':
                consumed += budgetImpact;
                if (whenMs >= todayMs) consumedToday += budgetImpact;
                else consumedBeforeToday += budgetImpact;
                break;
        }
    };

    for (const e of expenses) {
        if (!e.deleted && e.id) localExpenseIds.add(e.id);
        accumulateExpense(e);
    }

    // Include Divvy personal shares (daily budget, big expenses, and travel)
    if (Array.isArray(divvy.virtualExpenses)) {
        for (const ve of divvy.virtualExpenses) {
            const rawDivvyId = ve.id.startsWith('divvy_') ? ve.id.slice(6) : ve.id;
            if (localExpenseIds.has(ve.id) || localExpenseIds.has(rawDivvyId)) continue;
            accumulateExpense(ve);
        }
    } else {
        const divvyRegular = divvy.regularBudgetSpendALL ?? 0;
        const divvyBig = divvy.bigExpenseSpendALL ?? 0;
        const divvyTravel = divvy.travelSpendALL ?? 0;
        consumed += divvyRegular;
        consumedBeforeToday += divvyRegular;
        bigExpenseSpent += divvyBig;
        dreamsSpent += divvyTravel;
    }

    for (const t of transfers) {
        if (t.deleted) continue;
        const whenMs = new Date(t.timestamp).getTime();
        if (whenMs < startMs) continue;
        if (t.direction === 'BankToCash') {
            cashDelta += t.amountALL;
            cardDelta -= t.amountALL;
        } else {
            cashDelta -= t.amountALL;
            cardDelta += t.amountALL;
        }
    }

    const divvyCardDelta = divvy.walletCardDeltaALL ?? divvy.walletDeltaALL ?? 0;
    const divvyCashDelta = divvy.walletCashDeltaALL ?? 0;

    const startingCash = cycle.startingCashALL ?? 0;
    const estimatedBankBalance =
        cycle.startingRaiffeisenBalanceALL + cycle.stipendAmountALL + cardDelta + divvyCardDelta;
    const estimatedCashBalance = startingCash + cashDelta + divvyCashDelta;

    // Aux accounts count as part of the everyday pool.
    const auxAccountsTotal = totalAuxAccountsALL(cycle.customAccounts);

    const walletTotal = estimatedBankBalance + estimatedCashBalance + auxAccountsTotal;

    // Debts
    let receivablesALL = 0;
    let payablesALL = 0;
    for (const d of debts) {
        if (d.deleted || d.status !== 'open') continue;
        if (d.direction === 'OwedToMe') receivablesALL += d.remainingALL;
        else payablesALL += d.remainingALL;
    }
    const divvyReceivablesALL = divvy.receivablesALL;
    const divvyPayablesALL = divvy.payablesALL;
    const totalReceivablesALL = receivablesALL + divvyReceivablesALL;
    const totalPayablesALL = payablesALL + divvyPayablesALL;
    const netOfDebtsALL = totalReceivablesALL - totalPayablesALL;

    // Bucket balances
    const dreamsBalance = Math.max(0, cycle.travelStashALL - dreamsSpent);
    const savingsBalance = Math.max(0, cycle.savingsALL ?? 0);
    const investmentsBalance = Math.max(0, cycle.investmentsALL ?? 0);

    // Earmarks are INSIDE the wallet — held back from free-to-spend.
    const dreamsHeld = EARMARKS_INSIDE_WALLET ? dreamsBalance : 0;
    const savingsHeld = EARMARKS_INSIDE_WALLET ? savingsBalance : 0;
    const investmentsHeld = EARMARKS_INSIDE_WALLET ? investmentsBalance : 0;
    const totalEarmarked = dreamsHeld + savingsHeld + investmentsHeld;

    const plannedBig = cycle.plannedBigExpensesALL ?? 0;
    const unpaidBig = Math.max(0, plannedBig - bigExpenseSpent);

    const freeToSpend =
        walletTotal -
        unpaidBig -
        totalPayablesALL -
        totalEarmarked;

    const remaining = freeToSpend;
    const cycleBudget = freeToSpend + consumed;
    const percentConsumed = cycleBudget > 0
        ? Math.min(100, (consumed / cycleBudget) * 100)
        : 0;

    const baseDaily = cycleBudget / totalDays;
    const rawAllowance = (remaining + consumedToday) / daysLeft;
    const dailyAllowance = Math.min(baseDaily, rawAllowance);
    const leftToday = dailyAllowance - consumedToday;
    const bufferPool = Math.max(0, baseDaily * daysElapsed - consumedBeforeToday);

    return {
        cycleBudget,
        consumed,
        forgivenSpent,
        remaining,
        percentConsumed,
        plannedBig,
        bigExpenseSpent,
        unpaidBig,
        dreamsHeld,
        savingsHeld,
        investmentsHeld,
        totalEarmarked,
        freeToSpend,
        dreamsBalance,
        savingsBalance,
        investmentsBalance,
        dreamsSpent,
        totalDays,
        daysLeft: rawDaysLeft,
        dayNumber,
        isPaydayReached,
        dailyAllowance,
        consumedToday,
        leftToday,
        bufferPool,
        estimatedBankBalance,
        estimatedCashBalance,
        auxAccountsTotal,
        walletTotal,
        receivablesALL: totalReceivablesALL,
        payablesALL: totalPayablesALL,
        divvyReceivablesALL,
        divvyPayablesALL,
        netOfDebtsALL,
        netWorthALL: walletTotal + (EARMARKS_INSIDE_WALLET ? 0 : totalEarmarked) + netOfDebtsALL,
        spent: consumed,
        spentToday: consumedToday,
        estimatedTotalBalance: walletTotal,
        projectedSurplus: Math.max(0, remaining),
        // Legacy aliases
        travelStashBalance: dreamsBalance,
        travelStashHeld: dreamsHeld,
        travelSpent: dreamsSpent,
    };
}

export function dateToNoonISO(dateString: string): string {
    return `${dateString}T12:00:00Z`;
}