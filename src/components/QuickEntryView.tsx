// src/components/QuickEntryView.tsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useConvex } from 'convex/react';
import { api } from '../../convex/_generated/api';
import {
  ArrowRight,
  ShoppingCart,
  Utensils,
  Home,
  Bus,
  ShoppingBag,
  Sparkles,
  HeartPulse,
  PartyPopper,
  Plane,
  MoreHorizontal,
  Users,
  RotateCcw,
  Zap,
  Pencil,
  X,
  CreditCard,
  Banknote,
  ArrowLeftRight,
  HandCoins,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  TriangleAlert,
  Handshake,
  Calculator,
  ChevronsUpDown,
  UserCheck,
} from 'lucide-react';
import {
  type Category,
  CATEGORIES,
  type PaymentSource,
  type TransferDirection,
  type DebtDirection,
  type ExpenseRecord,
} from '../types';
import { RecentTransactions } from './RecentTransactions';
import { DebtsPanel } from './DebtsPanel';
import {
  addExpense,
  updateExpense,
  addTransfer,
  addDebt,
  updateDebt,
  settleDebtCash,
  db,
} from '../db';
import { useExpenses } from '../hooks/useExpenses';
import { useTransfers } from '../hooks/useTransfers';
import { useDebts } from '../hooks/useDebts';
import { useBudgetCycle } from '../hooks/useBudgetCycle';
import { useCurrency } from '../hooks/useCurrency';
import { convertToALL, convertFromALL, formatCurrency, evaluateAmountExpression } from '../utils/currency';
import { dateToNoonISO, toDateInputValue } from '../utils/budget';
import { CATEGORY_CONFIG, normalizeCategory } from '../utils/categoryConfig';
import { cn } from '../utils/cn';

type EntryMode = 'expense' | 'withdraw' | 'lend' | 'settle';
type PayMethod = 'Cash' | 'Card' | 'SomeoneElse';

const MODES: { id: EntryMode; label: string; icon: React.ReactNode }[] = [
  { id: 'expense', label: 'Expense', icon: <Zap className="w-3.5 h-3.5" /> },
  { id: 'withdraw', label: 'Withdraw', icon: <ArrowLeftRight className="w-3.5 h-3.5" /> },
  { id: 'lend', label: 'Lend', icon: <HandCoins className="w-3.5 h-3.5" /> },
  { id: 'settle', label: 'Settle', icon: <Check className="w-3.5 h-3.5" /> },
];

const CATEGORY_ICONS: Record<Category, React.ReactNode> = {
  Groceries: <ShoppingCart className="w-4 h-4 text-slate-600" />,
  'Eating Out': <Utensils className="w-4 h-4 text-slate-600" />,
  'Housing & Bills': <Home className="w-4 h-4 text-slate-600" />,
  Transport: <Bus className="w-4 h-4 text-slate-600" />,
  Shopping: <ShoppingBag className="w-4 h-4 text-slate-600" />,
  Personal: <Sparkles className="w-4 h-4 text-slate-600" />,
  'Health & Wellness': <HeartPulse className="w-4 h-4 text-slate-600" />,
  'Social & Fun': <PartyPopper className="w-4 h-4 text-slate-600" />,
  Travel: <Plane className="w-4 h-4 text-slate-600" />,
  Other: <MoreHorizontal className="w-4 h-4 text-slate-600" />,
};

interface Suggestion {
  name: string;
  count: number;
  latest: ExpenseRecord;
}

function buildSuggestions(
  expenses: ExpenseRecord[],
  category: Category,
  query: string
): Suggestion[] {
  const byName = new Map<string, Suggestion>();

  for (const e of expenses) {
    const normalized = normalizeCategory(e.category, {
      vendorType: e.vendorType,
      foodType: e.foodType,
    });
    if (normalized !== category || !e.itemName) continue;
    const name = e.itemName.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byName.set(key, { name, count: 1, latest: e });
    }
  }

  const q = query.trim().toLowerCase();
  return Array.from(byName.values())
    .filter((s) => {
      const lower = s.name.toLowerCase();
      return q ? lower.includes(q) && lower !== q : true;
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

const SuggestionChips: React.FC<{
  options: string[];
  value: string;
  onSelect: (value: string) => void;
}> = ({ options, value, onSelect }) => {
  const q = value.trim().toLowerCase();
  const filtered = options
    .filter((opt) => {
      const lower = opt.toLowerCase();
      return q ? lower.includes(q) && lower !== q : true;
    })
    .slice(0, 6);

  if (filtered.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {filtered.map((opt) => (
        <button
          key={opt}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(opt)}
          className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer transition-colors"
        >
          {opt}
        </button>
      ))}
    </div>
  );
};

const StyledSelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string; emoji?: string }>;
}> = ({ value, onChange, placeholder, options }) => {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium text-left flex items-center justify-between hover:border-slate-300 transition-colors cursor-pointer"
      >
        <span className={cn('truncate', selected ? 'text-slate-900 font-semibold' : 'text-slate-400')}>
          {selected
            ? `${selected.emoji ? selected.emoji + ' ' : ''}${selected.label}`
            : placeholder}
        </span>
        <ChevronsUpDown className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs bg-white rounded-3xl border border-slate-200 shadow-2xl p-4 space-y-2 font-sans"
          >
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2 mb-2">
              {placeholder}
            </h4>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className={cn(
                  'w-full text-left px-4 py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center justify-between',
                  !value
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                )}
              >
                <span>{placeholder}</span>
                {!value && <Check className="w-4 h-4 text-emerald-600" />}
              </button>
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-4 py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center justify-between',
                    value === opt.value
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                  )}
                >
                  <span>
                    {opt.emoji && <span className="mr-1.5">{opt.emoji}</span>}
                    {opt.label}
                  </span>
                  {value === opt.value && <Check className="w-4 h-4 text-emerald-600" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const QuickEntryView: React.FC = () => {
  const { expenses } = useExpenses();
  const { transfers } = useTransfers();
  const { openDebts, debts } = useDebts();
  const { stats } = useBudgetCycle();
  const { currency: defaultAppCurrency, format } = useCurrency();

  const convex = useConvex();
  const convexGroups = useQuery((api as any).groups?.getMyGroups || (api as any).groups?.listGroups, {}) || [];
  const addConvexExpense = useMutation((api as any).groups?.addExpense || (api as any).groups?.addGroupExpense);

  const [amountStr, setAmountStr] = useState<string>('');
  const [mode, setMode] = useState<EntryMode>('expense');

  const [category, setCategory] = useState<Category>('Eating Out');
  const [payMethod, setPayMethod] = useState<PayMethod>('Cash');
  const [payerName, setPayerName] = useState<string>('');

  const [isSplitWithFriend, setIsSplitWithFriend] = useState<boolean>(false);
  const [friendName, setFriendName] = useState<string>('');
  const [friendShareStr, setFriendShareStr] = useState<string>('');
  const [splitSyncGroupId, setSplitSyncGroupId] = useState<string>('');

  const [lendSyncGroupId, setLendSyncGroupId] = useState<string>('');

  const [dateOverride, setDateOverride] = useState<string | null>(null);
  const todayStr = toDateInputValue(new Date());

  const [itemName, setItemName] = useState<string>('');
  const [isItemFocused, setIsItemFocused] = useState(false);
  const [shareAmountStr, setShareAmountStr] = useState<string>('');

  const [withdrawDirection, setWithdrawDirection] = useState<TransferDirection>('BankToCash');

  const [lendPerson, setLendPerson] = useState<string>('');
  const [lendDirection, setLendDirection] = useState<DebtDirection>('OwedToMe');
  const [lendNote, setLendNote] = useState<string>('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingIsDebt, setEditingIsDebt] = useState<boolean>(false);
  const [originalDateOverride, setOriginalDateOverride] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isDebtsPanelOpen, setIsDebtsPanelOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const splitGroupDetails = useQuery(
    (api as any).groups?.getGroupDetails,
    splitSyncGroupId ? { groupId: splitSyncGroupId } : 'skip'
  );

  const splitGroupMembers = useMemo(() => {
    if (!splitGroupDetails || !Array.isArray(splitGroupDetails.members)) return [];
    return splitGroupDetails.members
      .map((m: any) => (m.name || '').trim())
      .filter((n: string) => n.length > 0);
  }, [splitGroupDetails]);

  const lendGroupDetails = useQuery(
    (api as any).groups?.getGroupDetails,
    lendSyncGroupId ? { groupId: lendSyncGroupId } : 'skip'
  );

  const lendGroupMembers = useMemo(() => {
    if (!lendGroupDetails || !Array.isArray(lendGroupDetails.members)) return [];
    return lendGroupDetails.members
      .map((m: any) => (m.name || '').trim())
      .filter((n: string) => n.length > 0);
  }, [lendGroupDetails]);

  const lendSuggestions = useMemo(() => {
    const names = new Set(debts.map((d) => d.counterparty));
    return Array.from(names).sort();
  }, [debts]);

  const debtGroups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; net: number; count: number }>();
    for (const d of openDebts) {
      let g = map.get(d.counterpartyKey);
      if (!g) {
        g = { key: d.counterpartyKey, name: d.counterparty, net: 0, count: 0 };
        map.set(d.counterpartyKey, g);
      }
      if (d.direction === 'OwedToMe') g.net += d.remainingALL;
      else g.net -= d.remainingALL;
      g.count++;
    }
    return Array.from(map.values()).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [openDebts]);

  const [settleGroupKey, setSettleGroupKey] = useState<string | null>(null);

  const parsedAmount = useMemo(() => {
    if (!amountStr.trim()) return 0;
    if (/[+\-*/()]/.test(amountStr)) {
      const result = evaluateAmountExpression(amountStr);
      return result ?? 0;
    }
    const n = parseFloat(amountStr.replace(/,/g, '.'));
    return Number.isNaN(n) ? 0 : n;
  }, [amountStr]);

  const isExpression = /[+\-*/()]/.test(amountStr) && amountStr.trim().length > 0;
  const normalizedALL = convertToALL(parsedAmount, defaultAppCurrency);

  const shareAmount = parseFloat(shareAmountStr.replace(/,/g, '.')) || 0;
  const normalizedShareALL = convertToALL(shareAmount, defaultAppCurrency);
  const hasShare = shareAmount > 0;

  const friendShareAmount = parseFloat(friendShareStr.replace(/,/g, '.')) || 0;
  const isSplitValid =
    !isSplitWithFriend ||
    (friendName.trim().length > 0 &&
      friendShareAmount > 0 &&
      friendShareAmount <= parsedAmount);

  const selectedGroup = debtGroups.find((g) => g.key === settleGroupKey);

  const isValid =
    parsedAmount > 0 &&
    (mode !== 'expense' || payMethod !== 'SomeoneElse' || payerName.trim().length > 0) &&
    (mode !== 'expense' || isSplitValid) &&
    (mode !== 'lend' || lendPerson.trim().length > 0) &&
    (mode !== 'settle' || selectedGroup !== undefined);

  const saveLabel = editingId
    ? 'Update Expense'
    : mode === 'expense'
      ? 'Save Expense'
      : mode === 'withdraw'
        ? 'Move Money'
        : mode === 'lend'
          ? 'Save Loan'
          : 'Settle Debt';

  const itemSuggestions = useMemo(
    () => buildSuggestions(expenses, category, itemName),
    [expenses, category, itemName]
  );

  const applySuggestion = (s: Suggestion) => {
    setItemName(s.name);
  };

  const handleModeChange = (next: EntryMode) => {
    if (editingId) return;
    setMode(next);
    if (next !== 'lend') setLendSyncGroupId('');
  };

  const handleCategoryChange = (next: Category) => {
    setCategory(next);
  };

  const handleItemNameChange = (val: string) => {
    setItemName(val);
  };

  const handleQuickAdd = (inc: number) => {
    setAmountStr((prev) => {
      const current = parseFloat(prev) || 0;
      return (current + inc).toString();
    });
  };

  const handleInsertOperator = (op: string) => {
    setAmountStr((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) {
        if (op === '(' || op === '-') return op;
        return '';
      }
      if (/[+\-*/]$/.test(trimmed) && op !== '(' && op !== ')') {
        return trimmed.slice(0, -1) + op;
      }
      return trimmed + op;
    });
  };

  const handleResolveMath = () => {
    if (parsedAmount > 0) {
      setAmountStr(String(parsedAmount));
    }
  };

  const handleResetForm = () => {
    setAmountStr('');
    setItemName('');
    setShareAmountStr('');
    setLendPerson('');
    setLendNote('');
    setLendSyncGroupId('');
    setSettleGroupKey(null);
    setPayerName('');
    setIsSplitWithFriend(false);
    setFriendName('');
    setFriendShareStr('');
    setSplitSyncGroupId('');
    inputRef.current?.focus();
  };

  const handleStartEdit = (expense: ExpenseRecord) => {
    setMode('expense');
    setEditingId(expense.id);
    setEditingIsDebt(Boolean(expense.debtId));
    setAmountStr(String(expense.amount));
    setCategory(
      normalizeCategory(expense.category, {
        vendorType: expense.vendorType,
        foodType: expense.foodType,
      })
    );
    setPayMethod(expense.walletNeutral ? 'SomeoneElse' : ((expense.paidWith as PayMethod) ?? 'Card'));
    setItemName(expense.itemName ?? '');
    setShareAmountStr('');

    const linkedDebt = debts.find((d) => d.id === expense.debtId || d.sourceExpenseId === expense.id);
    if (linkedDebt) {
      if (linkedDebt.direction === 'iOwe') {
        setPayMethod('SomeoneElse');
        setPayerName(linkedDebt.counterparty);
        setShareAmountStr(String(linkedDebt.amountALL));
      } else if (linkedDebt.direction === 'OwedToMe') {
        setIsSplitWithFriend(true);
        setFriendName(linkedDebt.counterparty);
        setFriendShareStr(String(linkedDebt.amountALL));
      }
    } else if (expense.budgetAmountALL !== undefined && expense.budgetAmountALL < expense.amountInALL) {
      setIsSplitWithFriend(true);
      setFriendShareStr(String(expense.amountInALL - expense.budgetAmountALL));
    }

    const expenseDate = toDateInputValue(new Date(expense.timestamp));
    const override = expenseDate === todayStr ? null : expenseDate;
    setDateOverride(override);
    setOriginalDateOverride(override);

    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingIsDebt(false);
    setOriginalDateOverride(null);
    setDateOverride(null);
    handleResetForm();
  };

  const handleSelectGroup = (key: string) => {
    setSettleGroupKey(key);
    const g = debtGroups.find((x) => x.key === key);
    if (g && (!amountStr || parseFloat(amountStr) === 0)) {
      setAmountStr(String(Math.abs(g.net)));
    }
  };

  const mirrorLendToDivvy = async (lendRecord: { counterparty: string }): Promise<string> => {
    if (!lendSyncGroupId) return '';

    try {
      const groupDetails: any = await convex.query(
        (api as any).groups.getGroupDetails,
        { groupId: lendSyncGroupId as any }
      );
      if (!groupDetails || !Array.isArray(groupDetails.members)) return '';

      const target = lendRecord.counterparty.trim().toLowerCase();
      const matchedMember = groupDetails.members.find(
        (m: any) => (m.name || '').trim().toLowerCase() === target
      );
      if (!matchedMember) {
        return ' · Divvy mirror skipped (no matching member)';
      }

      const selfMember =
        groupDetails.members.find((m: any) => m._id !== matchedMember._id) ??
        groupDetails.members[0];
      if (!selfMember) return '';

      const paidBy =
        lendDirection === 'OwedToMe' ? selfMember._id : matchedMember._id;
      const borrower =
        lendDirection === 'OwedToMe' ? matchedMember._id : selfMember._id;

      const groupCurrency: string = groupDetails.group?.currency || 'EUR';
      const amountInGroupCurrency =
        defaultAppCurrency === groupCurrency
          ? parsedAmount
          : convertFromALL(normalizedALL, groupCurrency as any);

      await addConvexExpense({
        groupId: lendSyncGroupId,
        title: lendNote.trim() || `Loan with ${lendRecord.counterparty}`,
        amount: parsedAmount,
        currency: defaultAppCurrency,
        amountInGroupCurrency,
        amountInALL: normalizedALL,
        category: 'Other',
        paidByMemberId: paidBy,
        splitType: 'exact',
        splits: [
          {
            memberId: borrower,
            amountGroup: amountInGroupCurrency,
            amountALL: normalizedALL,
          },
        ],
      });
      return ' · Synced to Divvy';
    } catch (err) {
      console.warn('Divvy lend mirror failed:', err);
      return ' · Divvy mirror failed';
    }
  };

  const mirrorSplitToDivvy = async (params: {
    groupId: string;
    friendName: string;
    totalAmount: number;
    myShare: number;
    friendShare: number;
    title: string;
    category: Category;
  }): Promise<string> => {
    try {
      const groupDetails: any = await convex.query(
        (api as any).groups.getGroupDetails,
        { groupId: params.groupId as any }
      );
      if (!groupDetails || !Array.isArray(groupDetails.members)) return '';

      const target = params.friendName.trim().toLowerCase();
      const matchedMember = groupDetails.members.find(
        (m: any) => (m.name || '').trim().toLowerCase() === target
      );
      if (!matchedMember) {
        return ' · Divvy mirror skipped (no matching member)';
      }

      const selfMember =
        groupDetails.members.find((m: any) => m._id !== matchedMember._id) ??
        groupDetails.members[0];
      if (!selfMember) return '';

      const groupCurrency: string = groupDetails.group?.currency || 'EUR';
      const totalALL = convertToALL(params.totalAmount, defaultAppCurrency);
      const friendCents = Math.round(params.friendShare * 100);
      const totalCents = Math.round(totalALL * 100);
      const selfCents = totalCents - friendCents;

      const totalGroup =
        defaultAppCurrency === groupCurrency
          ? params.totalAmount
          : convertFromALL(totalALL, groupCurrency as any);
      const friendGroup =
        defaultAppCurrency === groupCurrency
          ? friendShareAmount
          : convertFromALL(friendCents / 100, groupCurrency as any);
      const selfGroup = Math.round((totalGroup - friendGroup) * 100) / 100;

      await addConvexExpense({
        groupId: params.groupId,
        title: params.title,
        amount: params.totalAmount,
        currency: defaultAppCurrency,
        amountInGroupCurrency: totalGroup,
        amountInALL: totalALL,
        category: params.category || 'Other',
        paidByMemberId: selfMember._id,
        splitType: 'exact',
        splits: [
          { memberId: selfMember._id, amountGroup: selfGroup, amountALL: selfCents / 100 },
          { memberId: matchedMember._id, amountGroup: friendGroup, amountALL: friendCents / 100 },
        ],
      });
      return ' · Synced to Divvy';
    } catch (err) {
      console.warn('Divvy mirror failed:', err);
      return ' · Divvy mirror failed';
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isValid) {
      inputRef.current?.focus();
      return;
    }

    try {
      setIsSaving(true);
      const startTime = performance.now();

      if (mode === 'expense') {
        const timestamp = dateOverride ? dateToNoonISO(dateOverride) : undefined;
        const normalizedFriendShareALL = convertToALL(friendShareAmount, defaultAppCurrency);
        const myShareALL = isSplitWithFriend && friendShareAmount > 0
          ? Math.max(0, normalizedALL - normalizedFriendShareALL)
          : normalizedALL;
        const myShareDisplay = isSplitWithFriend && friendShareAmount > 0
          ? Math.max(0, parsedAmount - friendShareAmount)
          : parsedAmount;

        const baseData = {
          amount: parsedAmount,
          currency: defaultAppCurrency,
          category,
          itemName: itemName.trim() || undefined,
        };

        if (editingId) {
          const updates: Partial<Omit<ExpenseRecord, 'id'>> = {
            ...baseData,
            paidWith: payMethod === 'SomeoneElse' ? undefined : (payMethod as PaymentSource),
            walletNeutral: payMethod === 'SomeoneElse',
            budgetAmountALL: isSplitWithFriend && friendShareAmount > 0 ? myShareALL : undefined,
          };
          const dateChanged = dateOverride !== originalDateOverride;
          if (dateChanged) {
            updates.timestamp = dateOverride
              ? dateToNoonISO(dateOverride)
              : new Date().toISOString();
          }
          await updateExpense(editingId, updates);

          const existingDebt = debts.find((d) => d.id === editingId || d.sourceExpenseId === editingId);
          if (existingDebt) {
            if (payMethod === 'SomeoneElse') {
              const oweAmount = hasShare ? normalizedShareALL : normalizedALL;
              await updateDebt(existingDebt.id, {
                counterparty: payerName.trim(),
                amountALL: oweAmount,
                remainingALL: Math.min(existingDebt.remainingALL, oweAmount),
              });
            } else if (isSplitWithFriend && friendShareAmount > 0) {
              await updateDebt(existingDebt.id, {
                counterparty: friendName.trim(),
                amountALL: normalizedFriendShareALL,
                remainingALL: Math.min(existingDebt.remainingALL, normalizedFriendShareALL),
              });
            }
          }

          const latencyMs = Math.round(performance.now() - startTime);
          setFeedback(`Updated expense in ${latencyMs}ms ⚡`);
        } else {
          if (payMethod === 'SomeoneElse') {
            const myShareALLVal = hasShare ? normalizedShareALL : normalizedALL;
            const myShareDisplayVal = hasShare ? shareAmount : parsedAmount;

            await addDebt({
              counterparty: payerName.trim(),
              direction: 'iOwe',
              amountALL: myShareALLVal,
              myShareAmountALL: myShareALLVal,
              purchaseDetails: {
                category,
                itemName: itemName.trim() || undefined,
              },
              timestamp,
            });
            const latencyMs = Math.round(performance.now() - startTime);
            setFeedback(
              `Logged ${formatCurrency(myShareDisplayVal, defaultAppCurrency)} owed to ${payerName} in ${latencyMs}ms ⚡`
            );
          } else if (isSplitWithFriend && friendName.trim() && friendShareAmount > 0) {
            const debt = await addDebt({
              counterparty: friendName.trim(),
              direction: 'OwedToMe',
              amountALL: normalizedFriendShareALL,
              note: itemName.trim() ? `${itemName.trim()} (their share)` : undefined,
              timestamp,
            });

            const newExpense = await addExpense({
              ...baseData,
              paidWith: payMethod as PaymentSource,
              budgetAmountALL: myShareALL,
              debtId: debt.id,
              timestamp,
            });

            await db.debts.update(debt.id, { sourceExpenseId: newExpense.id });

            let mirrorSuffix = '';
            if (splitSyncGroupId) {
              mirrorSuffix = await mirrorSplitToDivvy({
                groupId: splitSyncGroupId,
                friendName: friendName.trim(),
                totalAmount: parsedAmount,
                myShare: myShareALL,
                friendShare: normalizedFriendShareALL,
                title: itemName.trim() || `${category} with ${friendName}`,
                category,
              });
            }

            const latencyMs = Math.round(performance.now() - startTime);
            setFeedback(
              `Logged ${formatCurrency(parsedAmount, defaultAppCurrency)} (${formatCurrency(myShareDisplay, defaultAppCurrency)} for you, ${formatCurrency(friendShareAmount, defaultAppCurrency)} owed by ${friendName})${mirrorSuffix} in ${latencyMs}ms ⚡`
            );
          } else {
            await addExpense({
              ...baseData,
              paidWith: payMethod as PaymentSource,
              timestamp,
            });
            const latencyMs = Math.round(performance.now() - startTime);
            setFeedback(
              dateOverride
                ? `Logged ${formatCurrency(parsedAmount, defaultAppCurrency)} for ${dateOverride}`
                : `Logged ${formatCurrency(parsedAmount, defaultAppCurrency)} in ${latencyMs}ms ⚡`
            );
          }
        }
        setEditingId(null);
        setEditingIsDebt(false);
        setOriginalDateOverride(null);
      } else if (mode === 'withdraw') {
        await addTransfer({
          amountALL: normalizedALL,
          direction: withdrawDirection,
        });
        setFeedback(
          `${withdrawDirection === 'BankToCash' ? 'Withdrew' : 'Deposited'} ${formatCurrency(parsedAmount, defaultAppCurrency)}`
        );
      } else if (mode === 'lend') {
        const lendRecord = await addDebt({
          counterparty: lendPerson,
          direction: lendDirection,
          amountALL: normalizedALL,
          note: lendNote.trim() || undefined,
          moveWalletWith: payMethod === 'SomeoneElse' ? 'Cash' : (payMethod as PaymentSource),
        });

        const mirrorSuffix = await mirrorLendToDivvy(lendRecord);

        setFeedback(
          (lendDirection === 'OwedToMe'
            ? `Lent ${formatCurrency(parsedAmount, defaultAppCurrency)} to ${lendPerson}`
            : `Borrowed ${formatCurrency(parsedAmount, defaultAppCurrency)} from ${lendPerson}`) +
          mirrorSuffix
        );
      } else if (mode === 'settle' && settleGroupKey) {
        const personDebts = openDebts.filter((d) => d.counterpartyKey === settleGroupKey);
        personDebts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        let remaining = normalizedALL;
        for (const d of personDebts) {
          if (remaining <= 0) break;
          const amt = Math.min(d.remainingALL, remaining);
          await settleDebtCash(d.id, amt, payMethod === 'SomeoneElse' ? 'Cash' : (payMethod as PaymentSource));
          remaining -= amt;
        }

        setFeedback(`Settled ${formatCurrency(parsedAmount, defaultAppCurrency)} with ${selectedGroup?.name}`);
      }

      setTimeout(() => setFeedback(null), 2500);
      handleResetForm();
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const spentThisCycle = stats?.spent ?? 0;

  const groupOptions = convexGroups.map((g: any) => ({
    value: g._id as string,
    label: g.name as string,
    emoji: '👥',
  }));

  return (
    <div className="w-full max-w-md mx-auto px-4 py-4 space-y-6 font-sans">
      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white border border-slate-200 shadow-xs">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <div className={cn('w-2 h-2 rounded-full', isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500')} />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Today's Allowance
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span
              className={cn(
                'text-base font-mono font-extrabold tracking-tight',
                stats && stats.spentToday > stats.dailyAllowance ? 'text-rose-600' : 'text-emerald-600'
              )}
            >
              {stats ? format(stats.spentToday) : '—'}
            </span>
            <span className="text-[10px] text-slate-400">/ {stats ? format(stats.dailyAllowance) : '—'}</span>
          </div>
        </div>

        <div className="text-right">
          <span className="text-sm font-mono font-bold text-slate-900 tracking-tight">
            {format(spentThisCycle)}
          </span>
          <p className="text-[10px] text-slate-400 font-mono mt-0.5">
            Cycle total
          </p>
        </div>
      </div>

      <form
        ref={formRef}
        onSubmit={handleSave}
        className="relative bg-white border border-slate-200 rounded-3xl p-6 shadow-xl shadow-slate-200/50 space-y-5"
      >
        {editingId && (
          <div
            className={cn(
              'flex flex-col gap-2 p-3 rounded-2xl border text-xs',
              editingIsDebt ? 'bg-indigo-50 border-indigo-200' : 'bg-amber-50 border-amber-200'
            )}
          >
            <div className="flex items-center justify-between">
              <div
                className={cn(
                  'flex items-center gap-1.5 font-bold',
                  editingIsDebt ? 'text-indigo-700' : 'text-amber-700'
                )}
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Editing {editingIsDebt ? 'shared split expense' : 'personal expense'}</span>
              </div>
              <button
                type="button"
                onClick={handleCancelEdit}
                className={cn(
                  'hover:underline cursor-pointer flex items-center gap-1 font-semibold',
                  editingIsDebt ? 'text-indigo-700' : 'text-amber-700'
                )}
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            </div>
            {editingIsDebt && (
              <div className="flex items-start gap-1.5 text-[10px] text-indigo-700 leading-snug">
                <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <p>Modifying this will update the wallet movement and recalculate the corresponding debt share.</p>
              </div>
            )}
          </div>
        )}

        <div className="text-center py-1">
          <div className="inline-flex items-center justify-center gap-2 max-w-full">
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0"
              className="w-full max-w-[280px] bg-transparent text-center font-mono text-5xl font-extrabold text-slate-900 placeholder-slate-300 focus:outline-none tracking-tight selection:bg-emerald-500/20"
              autoFocus
            />
          </div>

          {isExpression && parsedAmount > 0 && (
            <p className="text-xs font-mono text-emerald-600 mt-1 font-semibold flex items-center justify-center gap-1">
              <Calculator className="w-3 h-3" />= {format(convertToALL(parsedAmount, defaultAppCurrency))}
            </p>
          )}

          {!isExpression && defaultAppCurrency !== 'ALL' && parsedAmount > 0 && (
            <p className="text-xs font-mono text-emerald-600 mt-1 font-semibold">
              ≈ {formatCurrency(normalizedALL, 'ALL')} base Lek
            </p>
          )}

          <div className="flex items-center justify-center gap-1.5 mt-3 flex-wrap">
            {(defaultAppCurrency === 'ALL' ? [50, 100, 200, 500, 1000] : [1, 2, 5, 10, 20]).map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => handleQuickAdd(step)}
                className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-[11px] font-mono font-semibold text-slate-600 transition-all cursor-pointer active:scale-95"
              >
                +{step}
              </button>
            ))}
            {parsedAmount > 0 && (
              <button
                type="button"
                onClick={() => setAmountStr('')}
                className="px-2 py-1 rounded-xl bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-600 text-[11px] font-medium transition-colors cursor-pointer"
                title="Clear"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-center gap-1.5 mt-2 flex-wrap">
            {[
              { label: '+', op: '+' },
              { label: '−', op: '-' },
              { label: '×', op: '*' },
              { label: '÷', op: '/' },
              { label: '(', op: '(' },
              { label: ')', op: ')' },
            ].map(({ label, op }) => (
              <button
                key={op}
                type="button"
                onClick={() => handleInsertOperator(op)}
                className="w-8 h-7 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-mono font-bold text-slate-700 transition-all cursor-pointer active:scale-95"
                title={`Insert ${label}`}
              >
                {label}
              </button>
            ))}
            {isExpression && (
              <button
                type="button"
                onClick={handleResolveMath}
                className="px-2.5 h-7 flex items-center justify-center gap-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-mono font-bold transition-all cursor-pointer active:scale-95 shadow-xs"
                title="Evaluate expression"
              >
                <span>=</span>
                <span>{parsedAmount}</span>
              </button>
            )}
          </div>
        </div>

        {!editingId && (
          <div className="grid grid-cols-4 gap-1 p-1 rounded-2xl bg-slate-100 border border-slate-200">
            {MODES.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleModeChange(m.id)}
                  className={cn(
                    'flex flex-col items-center gap-0.5 py-2 rounded-xl text-[10px] font-bold transition-colors cursor-pointer',
                    active
                      ? 'bg-white text-emerald-600 shadow-xs'
                      : 'text-slate-400 hover:text-slate-600'
                  )}
                >
                  {m.icon}
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {mode === 'expense' && (
          <>
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Category
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {CATEGORIES.map((cat) => {
                  const selected = category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => handleCategoryChange(cat)}
                      className={cn(
                        'flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl border text-[9.5px] leading-tight font-bold transition-all cursor-pointer text-center min-w-0 min-h-[54px]',
                        selected
                          ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                      )}
                    >
                      <span className="shrink-0">{CATEGORY_ICONS[cat]}</span>
                      <span className="line-clamp-2 max-w-full">{cat}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <input
                type="text"
                value={itemName}
                onChange={(e) => handleItemNameChange(e.target.value)}
                onFocus={() => setIsItemFocused(true)}
                onBlur={() => setIsItemFocused(false)}
                placeholder={CATEGORY_CONFIG[category]?.itemPlaceholder || CATEGORY_CONFIG.Other.itemPlaceholder}
                list="pulse-item-names"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition-colors"
              />
              <datalist id="pulse-item-names">
                {itemSuggestions.map((s) => (
                  <option key={s.name} value={s.name} />
                ))}
              </datalist>
              {itemSuggestions.length > 0 && (isItemFocused || itemName.length === 0) && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {itemSuggestions.map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applySuggestion(s)}
                      className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer transition-colors"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-center">
              <div className="inline-flex p-1 rounded-2xl bg-slate-100 border border-slate-200">
                <button
                  type="button"
                  onClick={() => setPayMethod('Cash')}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer',
                    payMethod === 'Cash'
                      ? 'bg-white text-teal-700 shadow-xs font-bold'
                      : 'text-slate-400 hover:text-slate-600'
                  )}
                >
                  <Banknote className="w-3.5 h-3.5" />
                  Cash
                </button>
                <button
                  type="button"
                  onClick={() => setPayMethod('Card')}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer',
                    payMethod === 'Card'
                      ? 'bg-white text-rose-700 shadow-xs font-bold'
                      : 'text-slate-400 hover:text-slate-600'
                  )}
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  Bank
                </button>
                <button
                  type="button"
                  onClick={() => setPayMethod('SomeoneElse')}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer',
                    payMethod === 'SomeoneElse'
                      ? 'bg-white text-indigo-700 shadow-xs font-bold'
                      : 'text-slate-400 hover:text-slate-600'
                  )}
                >
                  <Handshake className="w-3.5 h-3.5" />
                  Someone Else
                </button>
              </div>
            </div>

            {(payMethod === 'Cash' || payMethod === 'Card') && (
              <div className="pt-1">
                {!isSplitWithFriend ? (
                  <button
                    type="button"
                    onClick={() => setIsSplitWithFriend(true)}
                    className="w-full py-2.5 px-3 rounded-2xl bg-indigo-50/80 hover:bg-indigo-100/80 border border-indigo-200/80 text-indigo-700 text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs"
                  >
                    <Users className="w-4 h-4 text-indigo-600" />
                    <span>Split portion with a friend</span>
                  </button>
                ) : (
                  <div className="p-4 rounded-3xl bg-indigo-50/50 border border-indigo-200/80 space-y-3.5 animate-in fade-in">
                    <div className="flex items-center justify-between pb-1 border-b border-indigo-100">
                      <span className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-indigo-600" />
                        Partial Expense Sharing
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSplitWithFriend(false);
                          setFriendName('');
                          setFriendShareStr('');
                          setSplitSyncGroupId('');
                        }}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer flex items-center gap-0.5"
                      >
                        <X className="w-3.5 h-3.5" />
                        Remove Split
                      </button>
                    </div>

                    {convexGroups.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Mirror to Divvy Group (Optional)
                        </p>
                        <StyledSelect
                          value={splitSyncGroupId}
                          onChange={(val) => {
                            setSplitSyncGroupId(val);
                            setFriendName('');
                          }}
                          placeholder="— Personal Only —"
                          options={groupOptions}
                        />
                      </div>
                    )}

                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <span>Who owes you?</span>
                        {splitSyncGroupId && (
                          <span className="text-emerald-600 font-semibold text-[9px] flex items-center gap-0.5">
                            <UserCheck className="w-3 h-3" /> Group Filter Active
                          </span>
                        )}
                      </p>

                      {splitSyncGroupId && splitGroupMembers.length > 0 ? (
                        <StyledSelect
                          value={friendName}
                          onChange={setFriendName}
                          placeholder="Select Group Member"
                          options={splitGroupMembers.map((m: string) => ({
                            value: m,
                            label: m,
                            emoji: '👤',
                          }))}
                        />
                      ) : (
                        <>
                          <input
                            type="text"
                            value={friendName}
                            onChange={(e) => setFriendName(e.target.value)}
                            placeholder="Person Name"
                            list="pulse-friend-names"
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                          />
                          <datalist id="pulse-friend-names">
                            {lendSuggestions.map((p) => (
                              <option key={p} value={p} />
                            ))}
                          </datalist>
                          <SuggestionChips
                            options={lendSuggestions}
                            value={friendName}
                            onSelect={setFriendName}
                          />
                        </>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider leading-tight min-w-0">
                          Their Owed Share:
                        </label>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            value={friendShareStr}
                            onChange={(e) => setFriendShareStr(e.target.value)}
                            placeholder="0"
                            className="w-24 sm:w-28 bg-white border border-indigo-200 rounded-xl px-2.5 py-1.5 text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                          />
                          <span className="text-xs font-bold text-indigo-700">{defaultAppCurrency}</span>
                        </div>
                      </div>

                      {parsedAmount > 0 && (
                        <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                          <span className="text-[10px] text-indigo-600 font-bold">Quick split:</span>
                          <button
                            type="button"
                            onClick={() => setFriendShareStr(String(Math.round((parsedAmount / 2) * 100) / 100))}
                            className="px-2 py-1 rounded-lg bg-white border border-indigo-200 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100 cursor-pointer"
                          >
                            50% ({Math.round(parsedAmount / 2)} {defaultAppCurrency})
                          </button>
                          <button
                            type="button"
                            onClick={() => setFriendShareStr(String(Math.round((parsedAmount / 3) * 100) / 100))}
                            className="px-2 py-0.5 rounded-lg bg-white border border-indigo-200 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100 cursor-pointer"
                          >
                            33% ({Math.round(parsedAmount / 3)} {defaultAppCurrency})
                          </button>
                          <button
                            type="button"
                            onClick={() => setFriendShareStr(String(Math.round((parsedAmount * 0.25) * 100) / 100))}
                            className="px-2 py-0.5 rounded-lg bg-white border border-indigo-200 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100 cursor-pointer"
                          >
                            25% ({Math.round(parsedAmount * 0.25)} {defaultAppCurrency})
                          </button>
                        </div>
                      )}
                    </div>

                    {parsedAmount > 0 && friendShareAmount > 0 && (
                      <div className="p-3 rounded-2xl bg-white border border-indigo-200 text-[11px] text-slate-700 space-y-1 font-sans shadow-2xs">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500 font-medium">Total Paid ({payMethod}):</span>
                          <span className="font-mono font-bold text-slate-900">{format(parsedAmount)}</span>
                        </div>
                        <div className="flex justify-between items-center text-indigo-700">
                          <span className="font-medium">Owed by {friendName || 'Friend'} (Debt Created):</span>
                          <span className="font-mono font-bold">+{formatCurrency(friendShareAmount, defaultAppCurrency)}</span>
                        </div>
                        <div className="flex justify-between items-center pt-1 border-t border-slate-100 text-emerald-700">
                          <span className="font-bold">Hits Your Daily Budget:</span>
                          <span className="font-mono font-extrabold">{formatCurrency(Math.max(0, parsedAmount - friendShareAmount), defaultAppCurrency)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {payMethod === 'SomeoneElse' && (
              <div className="pt-2 p-4 rounded-3xl bg-indigo-50/60 border border-indigo-200 space-y-3.5">
                <div className="flex items-center justify-between pb-1 border-b border-indigo-100">
                  <span className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Handshake className="w-4 h-4 text-indigo-600" />
                    Someone Else Paid For Me
                  </span>
                </div>

                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Who paid?
                  </p>
                  <input
                    type="text"
                    value={payerName}
                    onChange={(e) => setPayerName(e.target.value)}
                    placeholder="Payer Name"
                    list="pulse-payer-names"
                    className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                  />
                  <datalist id="pulse-payer-names">
                    {lendSuggestions.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                  <SuggestionChips
                    options={lendSuggestions}
                    value={payerName}
                    onSelect={setPayerName}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider leading-tight min-w-0">
                      Your Personal Share (You Owe):
                    </label>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={shareAmountStr}
                        onChange={(e) => setShareAmountStr(e.target.value)}
                        placeholder={parsedAmount > 0 ? String(parsedAmount) : '0'}
                        className="w-24 sm:w-28 bg-white border border-indigo-200 rounded-xl px-2.5 py-1.5 text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                      />
                      <span className="text-xs font-bold text-indigo-700">{defaultAppCurrency}</span>
                    </div>
                  </div>

                  {parsedAmount > 0 && (
                    <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                      <span className="text-[10px] text-indigo-600 font-bold">Quick split:</span>
                      <button
                        type="button"
                        onClick={() => setShareAmountStr(String(Math.round((parsedAmount / 2) * 100) / 100))}
                        className="px-2 py-1 rounded-lg bg-white border border-indigo-200 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100 cursor-pointer"
                      >
                        50% ({Math.round(parsedAmount / 2)} {defaultAppCurrency})
                      </button>
                      <button
                        type="button"
                        onClick={() => setShareAmountStr(String(parsedAmount))}
                        className="px-2 py-1 rounded-lg bg-white border border-indigo-200 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100 cursor-pointer"
                      >
                        100% ({parsedAmount} {defaultAppCurrency})
                      </button>
                    </div>
                  )}
                </div>

                {parsedAmount > 0 && (
                  <div className="p-3 rounded-2xl bg-white border border-indigo-200 text-[11px] text-slate-700 space-y-1 font-sans">
                    <div className="flex justify-between items-center text-slate-500">
                      <span>Total Payer Bill:</span>
                      <span className="font-mono font-bold">{format(parsedAmount)}</span>
                    </div>
                    <div className="flex justify-between items-center text-indigo-700">
                      <span>Debt Owed to {payerName || 'Payer'}:</span>
                      <span className="font-mono font-bold">-{formatCurrency(hasShare ? shareAmount : parsedAmount, defaultAppCurrency)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-slate-100 text-emerald-700">
                      <span className="font-bold">Hits Your Daily Budget:</span>
                      <span className="font-mono font-extrabold">{formatCurrency(hasShare ? shareAmount : parsedAmount, defaultAppCurrency)}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 italic pt-0.5">
                      Immediate wallet change: 0 L (Wallet hits only when debt is settled)
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 px-1 pt-1">
              <div className="flex items-center gap-2">
                {dateOverride && (
                  <button
                    type="button"
                    onClick={() => setDateOverride(null)}
                    className="text-[11px] text-emerald-600 hover:underline cursor-pointer font-bold"
                  >
                    Today
                  </button>
                )}
                <input
                  type="date"
                  value={dateOverride ?? todayStr}
                  max={todayStr}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDateOverride(v && v !== todayStr ? v : null);
                  }}
                  className={cn(
                    'bg-slate-50 border rounded-xl px-2 py-1 text-[11px] font-mono focus:outline-none focus:bg-white',
                    dateOverride
                      ? 'border-amber-400 text-amber-700 font-bold'
                      : 'border-slate-200 text-slate-600'
                  )}
                />
              </div>
            </div>
          </>
        )}

        {mode === 'withdraw' && (
          <div className="space-y-3">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Transfer Direction
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setWithdrawDirection('BankToCash')}
                className={cn(
                  'p-3 rounded-2xl border text-xs font-bold transition-all cursor-pointer',
                  withdrawDirection === 'BankToCash'
                    ? 'bg-amber-50 border-amber-500 text-amber-700 shadow-xs'
                    : 'bg-white border-slate-200 text-slate-500'
                )}
              >
                Bank → Cash (Withdraw)
              </button>
              <button
                type="button"
                onClick={() => setWithdrawDirection('CashToBank')}
                className={cn(
                  'p-3 rounded-2xl border text-xs font-bold transition-all cursor-pointer',
                  withdrawDirection === 'CashToBank'
                    ? 'bg-amber-50 border-amber-500 text-amber-700 shadow-xs'
                    : 'bg-white border-slate-200 text-slate-500'
                )}
              >
                Cash → Bank (Deposit)
              </button>
            </div>
          </div>
        )}

        {mode === 'lend' && (
          <div className="space-y-3">
            {convexGroups.length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Record in Divvy Group (Optional)
                </p>
                <StyledSelect
                  value={lendSyncGroupId}
                  onChange={(val) => {
                    setLendSyncGroupId(val);
                    setLendPerson('');
                  }}
                  placeholder="— Personal Only —"
                  options={groupOptions}
                />
              </div>
            )}

            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <span>Person</span>
                {lendSyncGroupId && (
                  <span className="text-emerald-600 font-semibold text-[9px] flex items-center gap-0.5">
                    <UserCheck className="w-3 h-3" /> Group Filter Active
                  </span>
                )}
              </p>

              {lendSyncGroupId && lendGroupMembers.length > 0 ? (
                <StyledSelect
                  value={lendPerson}
                  onChange={setLendPerson}
                  placeholder="Select Group Member"
                  options={lendGroupMembers.map((m: string) => ({
                    value: m,
                    label: m,
                    emoji: '👤',
                  }))}
                />
              ) : (
                <>
                  <input
                    type="text"
                    value={lendPerson}
                    onChange={(e) => setLendPerson(e.target.value)}
                    placeholder="Name"
                    list="pulse-lend-persons"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white"
                  />
                  <datalist id="pulse-lend-persons">
                    {lendSuggestions.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                  <SuggestionChips
                    options={lendSuggestions}
                    value={lendPerson}
                    onSelect={setLendPerson}
                  />
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLendDirection('OwedToMe')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer',
                  lendDirection === 'OwedToMe'
                    ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-xs'
                    : 'bg-white border-slate-200 text-slate-500'
                )}
              >
                <ArrowUpRight className="w-3.5 h-3.5 text-indigo-600" />
                I lent money
              </button>
              <button
                type="button"
                onClick={() => setLendDirection('iOwe')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer',
                  lendDirection === 'iOwe'
                    ? 'bg-rose-50 border-rose-500 text-rose-700 shadow-xs'
                    : 'bg-white border-slate-200 text-slate-500'
                )}
              >
                <ArrowDownLeft className="w-3.5 h-3.5 text-rose-600" />
                They lent me
              </button>
            </div>

            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Money Moved Via
              </p>
              <div className="inline-flex w-full p-1 rounded-2xl bg-slate-100 border border-slate-200">
                <button
                  type="button"
                  onClick={() => setPayMethod('Cash')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer',
                    payMethod === 'Cash'
                      ? 'bg-white text-teal-700 font-bold shadow-xs'
                      : 'text-slate-400'
                  )}
                >
                  <Banknote className="w-3.5 h-3.5" />
                  Cash
                </button>
                <button
                  type="button"
                  onClick={() => setPayMethod('Card')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer',
                    payMethod === 'Card'
                      ? 'bg-white text-rose-700 font-bold shadow-xs'
                      : 'text-slate-400'
                  )}
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  Bank
                </button>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Note (optional)
              </p>
              <input
                type="text"
                value={lendNote}
                onChange={(e) => setLendNote(e.target.value)}
                placeholder="What is this for?"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white"
              />
            </div>
          </div>
        )}

        {mode === 'settle' && (
          <div className="space-y-3">
            {debtGroups.length === 0 ? (
              <div className="text-center py-6 px-4 text-xs font-medium text-slate-500 rounded-2xl bg-slate-50 border border-slate-200">
                No active debts found. Use Expense or Lend mode to create one.
              </div>
            ) : (
              <>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Select Person to Settle
                </p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {debtGroups.map((g) => {
                    const selected = settleGroupKey === g.key;
                    return (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => handleSelectGroup(g.key)}
                        className={cn(
                          'w-full flex items-center justify-between p-3 rounded-2xl border text-xs font-bold transition-all cursor-pointer',
                          selected
                            ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded-xl bg-indigo-100 border border-indigo-200 flex items-center justify-center shrink-0">
                            <span className="text-xs font-extrabold text-indigo-700">{g.name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div className="text-left min-w-0">
                            <p className="text-xs font-bold truncate text-slate-900">{g.name}</p>
                            <p className="text-[10px] text-slate-400 font-normal">
                              {g.net > 0 ? 'owes you' : g.net < 0 ? 'you owe' : 'even'}
                            </p>
                          </div>
                        </div>
                        <p className={cn('text-sm font-mono font-extrabold shrink-0', g.net > 0 ? 'text-emerald-600' : g.net < 0 ? 'text-rose-600' : 'text-slate-400')}>
                          {format(Math.abs(g.net))}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {selectedGroup && (
                  <>
                    <div>
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                        Settled Via
                      </p>
                      <div className="inline-flex w-full p-1 rounded-2xl bg-slate-100 border border-slate-200">
                        <button
                          type="button"
                          onClick={() => setPayMethod('Cash')}
                          className={cn(
                            'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer',
                            payMethod === 'Cash'
                              ? 'bg-white text-teal-700 font-bold shadow-xs'
                              : 'text-slate-400'
                          )}
                        >
                          <Banknote className="w-3.5 h-3.5" />
                          Cash
                        </button>
                        <button
                          type="button"
                          onClick={() => setPayMethod('Card')}
                          className={cn(
                            'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer',
                            payMethod === 'Card'
                              ? 'bg-white text-rose-700 font-bold shadow-xs'
                              : 'text-slate-400'
                          )}
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          Bank
                        </button>
                      </div>
                    </div>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setIsDebtsPanelOpen(true)}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
                >
                  Manage all debts in full panel →
                </button>
              </>
            )}
          </div>
        )}

        <div className="space-y-2.5 pt-1">
          <button
            type="submit"
            disabled={!isValid || isSaving}
            className={cn(
              'w-full py-4 px-6 rounded-2xl font-extrabold text-base transition-all duration-150 flex items-center justify-center gap-2 shadow-lg cursor-pointer active:scale-[0.98]',
              isValid
                ? 'bg-emerald-600 text-white shadow-emerald-500/20 hover:bg-emerald-700'
                : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none'
            )}
          >
            <Zap className="w-5 h-5 fill-current" />
            <span>{saveLabel}</span>
            <ArrowRight className="w-4 h-4 ml-1" />
          </button>
        </div>

        {feedback && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 w-11/12 max-w-md bg-slate-900 border border-slate-700 text-white px-3.5 py-2.5 rounded-2xl text-xs font-semibold text-center shadow-xl flex items-center justify-center gap-2 animate-in fade-in slide-in-from-bottom-2">
            <Zap className="w-4 h-4 text-emerald-400 fill-emerald-400" />
            <span>{feedback}</span>
          </div>
        )}
      </form>

      <DebtsPanel isOpen={isDebtsPanelOpen} onClose={() => setIsDebtsPanelOpen(false)} />

      <RecentTransactions
        expenses={expenses}
        transfers={transfers}
        onEdit={handleStartEdit}
      />
    </div>
  );
};