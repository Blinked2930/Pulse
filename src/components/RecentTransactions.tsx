// src/components/RecentTransactions.tsx
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import {
  Trash2,
  Clock,
  ShoppingBasket,
  Utensils,
  Home,
  Bus,
  ShoppingBag,
  Sparkles,
  HeartPulse,
  PartyPopper,
  Plane,
  Users,
  MoreHorizontal,
  Receipt,
  Banknote,
  CreditCard,
  ArrowLeftRight,
  HandCoins,
  PlusCircle,
  TriangleAlert,
  ChevronDown,
  Scale,
  Gift,
} from 'lucide-react';
import type { ExpenseRecord, Category, TransferRecord } from '../types';
import { deleteExpense, deleteTransfer, hasLinkedDebt } from '../db';
import { useCurrency } from '../hooks/useCurrency';
import { classifyExpense, budgetImpactOf, isReconciliationEntry } from '../utils/budget';
import { normalizeCategory } from '../utils/categoryConfig';
import { cn } from '../utils/cn';

interface RecentTransactionsProps {
  expenses: ExpenseRecord[];
  transfers?: TransferRecord[];
  onDeleted?: () => void;
  onEdit?: (expense: ExpenseRecord) => void;
}

const PAGE_SIZE = 15;

const CATEGORY_ICONS: Record<Category, React.ReactNode> = {
  Groceries: <ShoppingBasket className="w-4 h-4 text-slate-700" />,
  'Eating Out': <Utensils className="w-4 h-4 text-slate-700" />,
  'Housing & Bills': <Home className="w-4 h-4 text-slate-700" />,
  Transport: <Bus className="w-4 h-4 text-slate-700" />,
  Shopping: <ShoppingBag className="w-4 h-4 text-slate-700" />,
  Personal: <Sparkles className="w-4 h-4 text-slate-700" />,
  'Health & Wellness': <HeartPulse className="w-4 h-4 text-slate-700" />,
  'Social & Fun': <PartyPopper className="w-4 h-4 text-slate-700" />,
  Travel: <Plane className="w-4 h-4 text-slate-700" />,
  Other: <MoreHorizontal className="w-4 h-4 text-slate-700" />,
};

function formatRelativeTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 45) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(isoString).toLocaleDateString('sq-AL', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Recent';
  }
}

function dayKey(isoString: string): string {
  const d = new Date(isoString);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  const todayKey = dayKey(today.toISOString());
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const yestKey = dayKey(yest.toISOString());
  if (key === todayKey) return 'Today';
  if (key === yestKey) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

type PrimaryKind =
  | 'expense'
  | 'gift'
  | 'lent'
  | 'borrowed'
  | 'repaid_to_me'
  | 'i_repaid'
  | 'offset'
  | 'big'
  | 'income'
  | 'reconciliation';

function primaryKind(e: ExpenseRecord): PrimaryKind {
  const name = (e.itemName ?? '').trim();
  const lowerName = name.toLowerCase();

  if (isReconciliationEntry(e)) return 'reconciliation';
  if (e.isBigExpense) return 'big';

  if (
    e.isDebtOrigin ||
    (e.debtRelated && (lowerName.startsWith('lent to ') || lowerName.startsWith('borrowed from ')))
  ) {
    return e.amount < 0 ? 'borrowed' : 'lent';
  }
  if (lowerName.startsWith('offset')) return 'offset';
  if (e.debtRelated) {
    if (lowerName.startsWith('repaid by ') || e.amount < 0) return 'repaid_to_me';
    return 'i_repaid';
  }

  if (e.isForgiveness || lowerName.includes('gift to') || lowerName.includes('forgiven to')) {
    return 'gift';
  }
  if (e.amount < 0) return 'income';
  return 'expense';
}

const SPENT_BUCKETS = new Set(['regular', 'noWalletSpending', 'forgiveness', 'travel', 'big']);

function isSpent(e: ExpenseRecord): boolean {
  return budgetImpactOf(e) > 0 && SPENT_BUCKETS.has(classifyExpense(e));
}

type AccountingState = 'inflow' | 'outflow' | 'neutral';

function iconStateClass(state: AccountingState): string {
  if (state === 'inflow') return 'text-emerald-600';
  if (state === 'outflow') return 'text-rose-600';
  return 'text-slate-300';
}

type MergedItem =
  | { kind: 'expense'; record: ExpenseRecord; timestamp: string; isConvex?: boolean; groupName?: string }
  | { kind: 'transfer'; record: TransferRecord; timestamp: string; isConvex?: boolean };

interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

const ConfirmDialog: React.FC<{ state: ConfirmState | null; onClose: () => void }> = ({
  state,
  onClose,
}) => {
  if (!state || !state.isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-5 space-y-4 animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
            <TriangleAlert className="w-5 h-5 text-rose-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-slate-900">{state.title}</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{state.message}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="py-3 rounded-2xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold cursor-pointer hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              state.onConfirm();
              onClose();
            }}
            className="py-3 rounded-2xl bg-rose-600 text-white text-xs font-bold cursor-pointer hover:bg-rose-700 transition-colors"
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export const RecentTransactions: React.FC<RecentTransactionsProps> = ({
  expenses,
  transfers = [],
  onDeleted,
  onEdit,
}) => {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { format } = useCurrency();

  const convexActivity = useQuery((api as any).groups?.getActivityFeed, {}) || [];

  const handleDeleteExpense = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const record = expenses.find((x) => x.id === id);

    const checkAndConfirm = async () => {
      const isLinked = await hasLinkedDebt(id, record?.debtId);
      if (isLinked) {
        setConfirm({
          isOpen: true,
          title: 'Delete both the transaction AND the debt?',
          message:
            'This transaction is linked to a debt record. Deleting it will also remove the debt and every entry linked to it. Continue?',
          confirmLabel: 'Delete both',
          onConfirm: async () => {
            await deleteExpense(id);
            if (onDeleted) onDeleted();
          },
        });
        return;
      }

      await deleteExpense(id);
      if (onDeleted) onDeleted();
    };

    void checkAndConfirm();
  };

  const handleDeleteTransfer = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteTransfer(id);
    if (onDeleted) onDeleted();
  };

  const handleRowClick = (expense: ExpenseRecord) => {
    if (onEdit) onEdit(expense);
  };

  const merged: MergedItem[] = useMemo(() => {
    const localExpenses: MergedItem[] = expenses
      .filter((e) => !e.deleted)
      .map((e) => ({ kind: 'expense' as const, record: e, timestamp: e.timestamp }));

    const localTransfers: MergedItem[] = transfers
      .filter((t) => !t.deleted)
      .map((t) => ({ kind: 'transfer' as const, record: t, timestamp: t.timestamp }));

    const remoteExpenses: MergedItem[] = convexActivity
      .filter((a: any) => {
        if (a.type === 'settlement') return a.involvesYou !== false;
        return a.syncToPulse !== false;
      })
      .map((a: any) => {
        if (a.type === 'settlement') {
          const isIncoming = Boolean(a.youReceived);
          const rawNative = Math.abs(a.amount ?? 0);
          const rawALL = Math.abs(a.amountInALL ?? a.amount ?? 0);
          return {
            kind: 'expense' as const,
            isConvex: true,
            groupName: a.groupName,
            timestamp: new Date(a.timestamp).toISOString(),
            record: {
              id: a.id || a._id,
              amount: isIncoming ? -rawNative : rawNative,
              amountInALL: isIncoming ? -rawALL : rawALL,
              budgetAmountALL: 0,
              currency: (a.currency || 'ALL') as ExpenseRecord['currency'],
              category: 'Other',
              itemName: `${a.groupName}: ${a.title}`,
              paidWith: a.paidWith || 'Card',
              debtRelated: true,
              walletNeutral: a.involvesYou === false,
              timestamp: new Date(a.timestamp).toISOString(),
              isSynced: true,
            } as ExpenseRecord,
          };
        }

        return {
          kind: 'expense' as const,
          isConvex: true,
          groupName: a.groupName,
          timestamp: new Date(a.timestamp).toISOString(),
          record: {
            id: a.id || a._id,
            amount: a.amount,
            amountInALL: a.amountInALL ?? a.amount,
            budgetAmountALL: typeof a.myShareALL === 'number' ? a.myShareALL : undefined,
            currency: (a.currency || 'ALL') as ExpenseRecord['currency'],
            category: normalizeCategory(a.category),
            itemName: `${a.groupName}: ${a.title}`,
            paidWith: a.paidWith || 'Card',
            walletNeutral: a.youPaid === false,
            isBigExpense: Boolean(a.isBigExpense),
            timestamp: new Date(a.timestamp).toISOString(),
            isSynced: true,
          } as ExpenseRecord,
        };
      });

    return [...localExpenses, ...localTransfers, ...remoteExpenses].sort((a, b) =>
      a.timestamp < b.timestamp ? 1 : -1
    );
  }, [expenses, transfers, convexActivity]);

  const grouped = useMemo(() => {
    const visible = merged.slice(0, visibleCount);
    const groups: { key: string; label: string; items: MergedItem[]; total: number }[] = [];
    const index = new Map<string, number>();
    for (const item of visible) {
      const key = dayKey(item.timestamp);
      if (!index.has(key)) {
        index.set(key, groups.length);
        groups.push({ key, label: dayLabel(key), items: [], total: 0 });
      }
      const g = groups[index.get(key)!];
      g.items.push(item);
      if (item.kind === 'expense' && isSpent(item.record)) {
        g.total += budgetImpactOf(item.record);
      }
    }
    return groups;
  }, [merged, visibleCount]);

  const hasMore = visibleCount < merged.length;

  if (merged.length === 0) {
    return (
      <>
        <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
        <div className="w-full text-center py-8 px-4 rounded-2xl bg-white border border-slate-200 border-dashed">
          <p className="text-xs font-medium text-slate-500">No activity logged yet.</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Enter an amount above to record your first transaction.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />

      <div className="w-full space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Recent activity
          </h2>
          <span className="text-[11px] font-mono text-slate-400">
            {Math.min(visibleCount, merged.length)} of {merged.length}
          </span>
        </div>

        {grouped.map((group) => (
          <div key={group.key} className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {group.label}
              </h3>
              {group.total > 0 && (
                <span className="text-[10px] font-mono text-slate-400">
                  {format(group.total)} spent
                </span>
              )}
            </div>

            {group.items.map((item) => {
              if (item.kind === 'transfer') {
                const t = item.record;
                const isBankToCash = t.direction === 'BankToCash';
                const label = isBankToCash ? 'Bank → Cash' : 'Cash → Bank';
                const cashState: AccountingState = isBankToCash ? 'inflow' : 'outflow';
                const bankState: AccountingState = isBankToCash ? 'outflow' : 'inflow';

                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between p-3 rounded-2xl bg-white border border-slate-200 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                        <ArrowLeftRight className="w-4 h-4 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-slate-900 truncate block">{label}</span>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-50 border border-slate-200/80">
                            <Receipt className={cn('w-3 h-3', iconStateClass('neutral'))} />
                            <Banknote className={cn('w-3 h-3', iconStateClass(cashState))} />
                            <CreditCard className={cn('w-3 h-3', iconStateClass(bankState))} />
                          </span>
                          <span>{formatRelativeTime(t.timestamp)}</span>
                          {!t.isSynced && <Clock className="w-3 h-3 text-slate-400" />}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <p className="text-sm font-bold font-mono text-amber-700 tracking-tight">
                        {format(t.amountALL)}
                      </p>
                      <div className="flex items-center justify-center w-[26px]">
                        <button
                          type="button"
                          onClick={(e) => handleDeleteTransfer(t.id, e)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                          title="Delete transfer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              const expense = item.record;
              const canonicalCategory = normalizeCategory(expense.category, {
                vendorType: expense.vendorType,
                foodType: expense.foodType,
              });
              const isForeignCurrency = expense.currency !== 'ALL';
              const kind = primaryKind(expense);
              const noWallet = Boolean(expense.walletNeutral);
              const isCash = expense.paidWith === 'Cash';
              const spent = isSpent(expense);
              const isIn = expense.amount < 0;
              const moneyKinds: PrimaryKind[] = [
                'lent',
                'borrowed',
                'repaid_to_me',
                'i_repaid',
                'offset',
                'reconciliation',
              ];

              const receiptState: AccountingState =
                kind === 'income' || budgetImpactOf(expense) < 0
                  ? 'inflow'
                  : spent
                    ? 'outflow'
                    : 'neutral';

              const cashState: AccountingState =
                noWallet || !isCash ? 'neutral' : isIn ? 'inflow' : 'outflow';

              const bankState: AccountingState =
                noWallet || isCash ? 'neutral' : isIn ? 'inflow' : 'outflow';

              let displayAmount: string;
              let amountColor: string;
              if (noWallet) {
                displayAmount = format(Math.abs(expense.amountInALL));
                amountColor = 'text-slate-500';
              } else if (moneyKinds.includes(kind)) {
                displayAmount = `${isIn ? '+' : '−'}${format(Math.abs(expense.amountInALL))}`;
                amountColor = isIn ? 'text-emerald-600' : 'text-rose-600';
              } else if (isIn) {
                displayAmount = `+${format(Math.abs(expense.amountInALL))}`;
                amountColor = 'text-emerald-600';
              } else {
                displayAmount = format(Math.abs(expense.amountInALL));
                amountColor = 'text-slate-900';
              }

              let icon: React.ReactNode;
              let tile = 'bg-slate-100 border-slate-200';
              if (item.isConvex) {
                icon = <Users className="w-4 h-4 text-emerald-600" />;
                tile = 'bg-emerald-50 border-emerald-200';
              } else if (kind === 'reconciliation') {
                icon = <Scale className="w-4 h-4 text-amber-600" />;
                tile = 'bg-amber-50 border-amber-200';
              } else if (kind === 'gift') {
                icon = <Gift className="w-4 h-4 text-rose-600" />;
                tile = 'bg-rose-50 border-rose-200';
              } else if (kind === 'lent' || kind === 'borrowed') {
                icon = <HandCoins className="w-4 h-4 text-indigo-500" />;
                tile = 'bg-indigo-50 border-indigo-200';
              } else if (kind === 'repaid_to_me' || kind === 'i_repaid') {
                icon = <HandCoins className="w-4 h-4 text-emerald-600" />;
                tile = 'bg-emerald-50 border-emerald-200';
              } else if (kind === 'offset') {
                icon = <HandCoins className="w-4 h-4 text-slate-500" />;
                tile = 'bg-slate-100 border-slate-200';
              } else if (kind === 'income') {
                icon = <PlusCircle className="w-4 h-4 text-emerald-600" />;
                tile = 'bg-emerald-50 border-emerald-200';
              } else {
                icon = CATEGORY_ICONS[canonicalCategory] || <MoreHorizontal className="w-4 h-4 text-slate-700" />;
              }

              const showsBudgetShare =
                expense.budgetAmountALL !== undefined &&
                Math.abs(expense.budgetAmountALL - expense.amountInALL) >= 1 &&
                expense.budgetAmountALL > 0;

              return (
                <div
                  key={expense.id}
                  onClick={() => !item.isConvex && handleRowClick(expense)}
                  className={`flex items-center justify-between p-3 rounded-2xl bg-white transition-all border border-slate-200 shadow-sm ${
                    !item.isConvex ? 'cursor-pointer hover:border-emerald-300 hover:shadow-md' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border', tile)}>
                      {icon}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-semibold text-slate-900 truncate">
                          {expense.itemName || (isIn ? 'Income' : canonicalCategory)}
                        </span>
                        {item.isConvex && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold shrink-0">
                            {item.groupName || 'Divvy'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-50 border border-slate-200/80">
                          <Receipt className={cn('w-3 h-3', iconStateClass(receiptState))} />
                          <Banknote className={cn('w-3 h-3', iconStateClass(cashState))} />
                          <CreditCard className={cn('w-3 h-3', iconStateClass(bankState))} />
                        </span>
                        <span>{formatRelativeTime(expense.timestamp)}</span>
                        {!expense.isSynced && <Clock className="w-3 h-3 text-slate-400" />}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <div className="text-right">
                      <p className={cn('text-sm font-bold font-mono tracking-tight', amountColor)}>
                        {displayAmount}
                      </p>
                      {showsBudgetShare && (
                        <p className="text-[10px] font-mono text-slate-400">
                          your share {format(expense.budgetAmountALL as number)}
                        </p>
                      )}
                      {isForeignCurrency && (
                        <p className="text-[10px] font-mono text-emerald-600 font-medium">
                          ≈ {format(Math.abs(expense.amountInALL))}
                        </p>
                      )}
                    </div>

                    {!item.isConvex && (
                      <div className="flex items-center justify-center w-[26px]">
                        <button
                          type="button"
                          onClick={(e) => handleDeleteExpense(expense.id, e)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                          title="Delete record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {hasMore ? (
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="w-full py-3 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 text-xs font-semibold transition-colors cursor-pointer shadow-sm flex items-center justify-center gap-1.5"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            Load older entries
            <span className="text-[10px] text-slate-400 font-mono">
              ({merged.length - visibleCount} remaining)
            </span>
          </button>
        ) : (
          <p className="text-center text-[10px] text-slate-400 py-3">
            You've reached the beginning.
          </p>
        )}
      </div>
    </>
  );
};