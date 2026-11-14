// src/utils/divvyBridge.ts
import {
  type Category,
  DEFAULT_EXCHANGE_RATES,
  type ExchangeRates,
  type ExpenseRecord,
} from '../types';
import { normalizeCategory } from './categoryConfig';

export interface BridgeGroupMember {
  _id: string;
  name: string;
  userId?: string;
}

export interface BridgeGroupExpense {
  _id: string;
  groupId: string;
  groupName: string;
  title: string;
  category?: string;
  currency: string;
  amount: number;
  amountInALL: number;
  fxRateToALL?: number;
  paidByMemberId: string;
  splitType: 'equal' | 'exact' | 'shares';
  splits: Array<{ memberId: string; amountALL: number; amountGroup?: number }>;
  paidWith?: 'Cash' | 'Card';
  isBigExpense?: boolean;
  syncToPulse?: boolean;
  pulseSourceExpenseId?: string;
  timestamp: number;
}

export interface BridgeGroupSettlement {
  _id: string;
  groupId: string;
  groupName: string;
  fromMemberId: string;
  toMemberId: string;
  amount?: number;
  amountALL: number;
  fxRateToALL?: number;
  currency: string;
  paidWith?: 'Cash' | 'Card';
  timestamp: number;
}

export interface BridgeGroupDetails {
  group: { _id: string; name: string; currency: string; status?: string };
  members: BridgeGroupMember[];
  expenses: Omit<BridgeGroupExpense, 'groupId' | 'groupName'>[];
  settlements: Omit<BridgeGroupSettlement, 'groupId' | 'groupName'>[];
}

export interface BridgeGroupSummary {
  _id: string;
  name: string;
  currency?: string;
  myNetBalanceALL: number;
  myNetBalanceGroup?: number;
  memberCount: number;
  isOwner?: boolean;
}

export interface BridgeMyShare {
  expenseId: string;
  amountALL: number;
  category: Category;
  isBigExpense: boolean;
  paidByMemberId: string;
  paidByMemberName: string;
  youPaid: boolean;
  paidWith: 'Cash' | 'Card';
  timestamp: number;
  groupId: string;
  groupName: string;
  title: string;
}

export interface BridgeCycleRollup {
  expensesYouPaid: BridgeGroupExpense[];
  yourSharesOfExpenses: BridgeMyShare[];
  yourSharesOfOthersExpenses: BridgeMyShare[];
  settlementsOut: BridgeGroupSettlement[];
  settlementsIn: BridgeGroupSettlement[];

  // Physical wallet outflows / inflows in ALL (for Bank & Cash balances)
  totalExpensesYouPaidALL: number;
  totalExpensesYouPaidCardALL: number;
  totalExpensesYouPaidCashALL: number;
  totalSettlementsOutALL: number;
  totalSettlementsOutCardALL: number;
  totalSettlementsOutCashALL: number;
  totalSettlementsInALL: number;
  totalSettlementsInCardALL: number;
  totalSettlementsInCashALL: number;

  walletDeltaALL: number;
  walletCardDeltaALL: number;
  walletCashDeltaALL: number;

  // Your personal consumption shares ONLY (never your friend's portion)
  totalMyConsumptionALL: number;
  totalMyRegularBudgetShareALL: number; // Counts against daily Left to Spend
  totalMyBigExpenseShareALL: number;    // Counts against Planned Big Expenses
  totalMyTravelShareALL: number;        // Counts against Travel Stash
  totalYourSharesALL: number;           // Legacy alias: shares of others' expenses

  categoryTotals: Partial<Record<Category, number>>;
  categoryCounts: Partial<Record<Category, number>>;

  // Virtual ExpenseRecords representing your personal share for Insights & Budget
  virtualExpenses: ExpenseRecord[];
}

function normalizeExpenseAmounts(
  exp: Omit<BridgeGroupExpense, 'groupId' | 'groupName'>,
  rates: ExchangeRates
): { amountInALL: number; splits: Array<{ memberId: string; amountALL: number; amountGroup?: number }> } {
  const cur = (exp.currency || 'ALL').trim().toUpperCase();
  if (cur === 'ALL') {
    return { amountInALL: exp.amountInALL, splits: exp.splits };
  }
  const rate = rates[cur];
  // Guard against pre-fix records where amountInALL was stored 1:1 with non-ALL amount
  if (rate && rate !== 1 && Math.abs(exp.amountInALL - exp.amount) < 0.001) {
    const fixedTotal = Math.round(exp.amount * rate * 100) / 100;
    const fixedSplits = exp.splits.map((s) => ({
      ...s,
      amountALL: Math.round(s.amountALL * rate * 100) / 100,
    }));
    return { amountInALL: fixedTotal, splits: fixedSplits };
  }
  return { amountInALL: exp.amountInALL, splits: exp.splits };
}

function normalizeSettlementAmountALL(
  set: Omit<BridgeGroupSettlement, 'groupId' | 'groupName'>,
  rates: ExchangeRates
): number {
  const cur = (set.currency || 'ALL').trim().toUpperCase();
  if (cur === 'ALL') return set.amountALL;
  const rate = rates[cur];
  if (
    rate &&
    rate !== 1 &&
    (set.amount === undefined || Math.abs(set.amountALL - set.amount) < 0.001)
  ) {
    return Math.round((set.amount ?? set.amountALL) * rate * 100) / 100;
  }
  return set.amountALL;
}

export function mapDivvyCategory(raw?: string): Category {
  return normalizeCategory(raw);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function findSelfMember(
  members: BridgeGroupMember[],
  clerkUserId: string | null | undefined,
  displayNames: string[]
): BridgeGroupMember | null {
  if (clerkUserId) {
    const byId = members.find((m) => m.userId === clerkUserId);
    if (byId) return byId;
  }
  const candidateNames = displayNames
    .map((n) => normalizeName(n ?? ''))
    .filter((n) => n.length > 0);
  if (candidateNames.length > 0) {
    for (const m of members) {
      if (candidateNames.includes(normalizeName(m.name))) return m;
    }
  }
  const byAnon = members.find((m) => !m.userId || m.userId === 'anonymous');
  return byAnon ?? null;
}

interface RollupInput {
  groupSummaries?: BridgeGroupSummary[];
  groupDetailsList?: BridgeGroupDetails[];
  groupDetailsById?: Record<string, BridgeGroupDetails | null | undefined>;
  cycleStartMs: number;
  clerkUserId: string | null | undefined;
  displayNames: string[];
  rates?: ExchangeRates;
}

export function buildCycleRollup(input: RollupInput): BridgeCycleRollup {
  const rates = input.rates ?? DEFAULT_EXCHANGE_RATES;
  const result: BridgeCycleRollup = {
    expensesYouPaid: [],
    yourSharesOfExpenses: [],
    yourSharesOfOthersExpenses: [],
    settlementsOut: [],
    settlementsIn: [],

    totalExpensesYouPaidALL: 0,
    totalExpensesYouPaidCardALL: 0,
    totalExpensesYouPaidCashALL: 0,
    totalSettlementsOutALL: 0,
    totalSettlementsOutCardALL: 0,
    totalSettlementsOutCashALL: 0,
    totalSettlementsInALL: 0,
    totalSettlementsInCardALL: 0,
    totalSettlementsInCashALL: 0,

    walletDeltaALL: 0,
    walletCardDeltaALL: 0,
    walletCashDeltaALL: 0,

    totalMyConsumptionALL: 0,
    totalMyRegularBudgetShareALL: 0,
    totalMyBigExpenseShareALL: 0,
    totalMyTravelShareALL: 0,
    totalYourSharesALL: 0,

    categoryTotals: {},
    categoryCounts: {},
    virtualExpenses: [],
  };

  // Build unified list of group details from either array or map + summaries
  const detailsList: BridgeGroupDetails[] = [];
  if (Array.isArray(input.groupDetailsList) && input.groupDetailsList.length > 0) {
    detailsList.push(...input.groupDetailsList);
  } else if (input.groupSummaries && input.groupDetailsById) {
    for (const summary of input.groupSummaries) {
      const d = input.groupDetailsById[summary._id];
      if (d) detailsList.push(d);
    }
  }

  for (const details of detailsList) {
    const self = findSelfMember(details.members, input.clerkUserId, input.displayNames);
    if (!self) continue;

    const memberNameById = new Map<string, string>();
    for (const m of details.members) memberNameById.set(m._id, m.name);

    // ---- Expenses ----
    for (const exp of details.expenses) {
      if (exp.timestamp < input.cycleStartMs) continue;
      // Skip expenses explicitly opted out of Pulse Budget tracking
      if (exp.syncToPulse === false) continue;

      const normalized = normalizeExpenseAmounts(exp, rates);
      const youPaid = exp.paidByMemberId === self._id;
      const source: 'Cash' | 'Card' = exp.paidWith === 'Cash' ? 'Cash' : 'Card';
      const category = mapDivvyCategory(exp.category);
      const isBig = Boolean(exp.isBigExpense);

      // 1. Physical wallet outflow if YOU paid the bill
      if (youPaid) {
        const enriched: BridgeGroupExpense = {
          ...exp,
          amountInALL: normalized.amountInALL,
          splits: normalized.splits,
          paidWith: source,
          groupId: details.group._id,
          groupName: details.group.name,
        };
        result.expensesYouPaid.push(enriched);
        result.totalExpensesYouPaidALL += normalized.amountInALL;
        if (source === 'Cash') {
          result.totalExpensesYouPaidCashALL += normalized.amountInALL;
        } else {
          result.totalExpensesYouPaidCardALL += normalized.amountInALL;
        }
      }

      // 2. YOUR personal consumption share ONLY (whether you paid or someone else paid)
      const yourSplit = normalized.splits.find((s) => s.memberId === self._id);
      const myShareALL = yourSplit ? Math.max(0, yourSplit.amountALL) : 0;

      if (myShareALL > 0) {
        const paidByName = memberNameById.get(exp.paidByMemberId) ?? 'Someone';
        const shareEntry: BridgeMyShare = {
          expenseId: exp._id,
          amountALL: myShareALL,
          category,
          isBigExpense: isBig,
          paidByMemberId: exp.paidByMemberId,
          paidByMemberName: paidByName,
          youPaid,
          paidWith: source,
          timestamp: exp.timestamp,
          groupId: details.group._id,
          groupName: details.group.name,
          title: exp.title,
        };

        result.yourSharesOfExpenses.push(shareEntry);
        if (!youPaid) {
          result.yourSharesOfOthersExpenses.push(shareEntry);
          result.totalYourSharesALL += myShareALL;
        }

        result.totalMyConsumptionALL += myShareALL;
        result.categoryTotals[category] = (result.categoryTotals[category] ?? 0) + myShareALL;
        result.categoryCounts[category] = (result.categoryCounts[category] ?? 0) + 1;

        if (isBig) {
          result.totalMyBigExpenseShareALL += myShareALL;
        } else if (category === 'Travel') {
          result.totalMyTravelShareALL += myShareALL;
        } else {
          result.totalMyRegularBudgetShareALL += myShareALL;
        }

        // Virtual ExpenseRecord for unified analytics & budget aggregation
        result.virtualExpenses.push({
          id: `divvy_${exp._id}`,
          amount: myShareALL,
          currency: 'ALL',
          amountInALL: myShareALL,
          budgetAmountALL: myShareALL,
          category,
          itemName: `${exp.title} (${details.group.name})`,
          paidWith: source,
          walletNeutral: true, // Wallet delta is already applied via walletCardDeltaALL / walletCashDeltaALL
          isBigExpense: isBig,
          timestamp: new Date(exp.timestamp).toISOString(),
          isSynced: true,
        });
      }
    }

    // ---- Settlements ----
    for (const set of details.settlements) {
      if (set.timestamp < input.cycleStartMs) continue;

      const normalizedAmountALL = normalizeSettlementAmountALL(set, rates);
      const source: 'Cash' | 'Card' = set.paidWith === 'Cash' ? 'Cash' : 'Card';
      const enriched: BridgeGroupSettlement = {
        ...set,
        amountALL: normalizedAmountALL,
        paidWith: source,
        groupId: details.group._id,
        groupName: details.group.name,
      };

      if (set.fromMemberId === self._id) {
        result.settlementsOut.push(enriched);
        result.totalSettlementsOutALL += normalizedAmountALL;
        if (source === 'Cash') {
          result.totalSettlementsOutCashALL += normalizedAmountALL;
        } else {
          result.totalSettlementsOutCardALL += normalizedAmountALL;
        }
      } else if (set.toMemberId === self._id) {
        result.settlementsIn.push(enriched);
        result.totalSettlementsInALL += normalizedAmountALL;
        if (source === 'Cash') {
          result.totalSettlementsInCashALL += normalizedAmountALL;
        } else {
          result.totalSettlementsInCardALL += normalizedAmountALL;
        }
      }
    }
  }

  result.walletCardDeltaALL =
    -result.totalExpensesYouPaidCardALL -
    result.totalSettlementsOutCardALL +
    result.totalSettlementsInCardALL;

  result.walletCashDeltaALL =
    -result.totalExpensesYouPaidCashALL -
    result.totalSettlementsOutCashALL +
    result.totalSettlementsInCashALL;

  result.walletDeltaALL = result.walletCardDeltaALL + result.walletCashDeltaALL;

  return result;
}

export function walletDeltaFromRollup(rollup: BridgeCycleRollup): number {
  return rollup.walletDeltaALL;
}