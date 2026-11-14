// src/components/DebtsPanel.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import {
  X,
  Plus,
  HandCoins,
  ArrowUpRight,
  ArrowDownLeft,
  Banknote,
  Wallet,
  ChevronDown,
  Trash2,
  Pencil,
  TriangleAlert,
  Search,
  RotateCcw,
  Sparkles,
  ArrowRightLeft,
  Gift,
} from 'lucide-react';
import { useDebts } from '../hooks/useDebts';
import { useExpenses } from '../hooks/useExpenses';
import {
  addDebt,
  settleDebtCash,
  settleDebtOffset,
  writeOffDebt,
  deleteDebt,
  deleteExpense,
  getCounterparties,
  updateDebt,
  hasLinkedExpenses,
  db,
} from '../db';
import { useCurrency } from '../hooks/useCurrency';
import { convertFromALL, formatCurrency } from '../utils/currency';
import { cn } from '../utils/cn';
import type { Currency, DebtDirection, DebtRecord, ExpenseRecord, PaymentSource } from '../types';

interface DebtsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialCounterparty?: string | null;
}

interface CounterpartyGroup {
  key: string;
  name: string;
  openDebts: DebtRecord[];
  resolvedDebts: DebtRecord[];
  receivables: number;
  payables: number;
}

type FeedItem =
  | { id: string; type: 'debt'; data: DebtRecord; timestamp: string }
  | { id: string; type: 'expense'; data: ExpenseRecord; timestamp: string };

function formatDebtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

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
      className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-4.5 space-y-3.5 animate-in zoom-in-95 font-sans border border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
            <TriangleAlert className="w-4 h-4 text-rose-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-slate-900">{state.title}</h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{state.message}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs font-semibold cursor-pointer hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              state.onConfirm();
              onClose();
            }}
            className="py-2 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer hover:bg-rose-700 transition-colors"
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const NewDebtForm: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const [counterparty, setCounterparty] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState<DebtDirection>('OwedToMe');
  const [paidWith, setPaidWith] = useState<PaymentSource>('Cash');
  const [isSaving, setIsSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    getCounterparties().then(setSuggestions);
  }, []);

  const amount = parseFloat(amountStr) || 0;
  const valid = counterparty.trim().length > 0 && amount > 0;

  const handleSave = async () => {
    if (!valid) return;
    setIsSaving(true);
    await addDebt({
      counterparty,
      direction,
      amountALL: amount,
      note: note.trim() || undefined,
      moveWalletWith: paidWith,
    });
    setIsSaving(false);
    setCounterparty('');
    setAmountStr('');
    setNote('');
    setDirection('OwedToMe');
    setPaidWith('Cash');
    onSaved();
  };

  return (
    <div className="p-3.5 rounded-2xl bg-indigo-50/50 border border-indigo-100 space-y-3 font-sans">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5 text-indigo-600" />
          Add Entry
        </h4>
      </div>

      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
          Who paid / lent?
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setDirection('OwedToMe')}
            className={cn(
              'flex items-center justify-center gap-1 py-1.5 px-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer',
              direction === 'OwedToMe'
                ? 'bg-emerald-50/80 border-emerald-300 text-emerald-800 shadow-2xs font-bold'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            )}
          >
            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
            I paid for them
          </button>
          <button
            type="button"
            onClick={() => setDirection('iOwe')}
            className={cn(
              'flex items-center justify-center gap-1 py-1.5 px-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer',
              direction === 'iOwe'
                ? 'bg-rose-50/80 border-rose-300 text-rose-800 shadow-2xs font-bold'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            )}
          >
            <ArrowDownLeft className="w-3.5 h-3.5 text-rose-600" />
            They paid for me
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <input
            type="text"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            placeholder="Person Name"
            list="pulse-counterparties-panel"
            className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
          />
          <datalist id="pulse-counterparties-panel">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder="Amount (Lek)"
          className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
        />
      </div>

      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
          Payment Method
        </p>
        <div className="inline-flex w-full p-0.5 rounded-xl bg-white border border-slate-200">
          <button
            type="button"
            onClick={() => setPaidWith('Cash')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer',
              paidWith === 'Cash' ? 'bg-teal-50 text-teal-800 font-bold' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <Banknote className="w-3.5 h-3.5 text-teal-600" />
            Physical Cash
          </button>
          <button
            type="button"
            onClick={() => setPaidWith('Card')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer',
              paidWith === 'Card' ? 'bg-indigo-50 text-indigo-800 font-bold' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <Wallet className="w-3.5 h-3.5 text-indigo-600" />
            Bank (Card)
          </button>
        </div>
      </div>

      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (e.g. Dinner, Coffee, Groceries)"
        className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
      />

      <button
        type="button"
        onClick={handleSave}
        disabled={!valid || isSaving}
        className="w-full py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50 hover:bg-indigo-700 transition-colors shadow-2xs"
      >
        {isSaving ? 'Saving…' : 'Add to Ledger'}
      </button>
    </div>
  );
};

const SettlementExpenseRow: React.FC<{
  expense: ExpenseRecord;
  onDelete: (expense: ExpenseRecord) => void;
}> = ({ expense, onDelete }) => {
  const { format } = useCurrency();
  const isOffset = expense.walletNeutral && !expense.isForgiveness;
  const isForgive = expense.isForgiveness;
  const isCash = !expense.walletNeutral && !expense.isForgiveness;

  return (
    <div className="p-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 flex items-center justify-between gap-2.5 font-sans transition-colors">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {isOffset && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200/60 flex items-center gap-1">
              <ArrowRightLeft className="w-2.5 h-2.5 text-amber-600" />
              Offset
            </span>
          )}
          {isForgive && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200/60 flex items-center gap-1">
              <Gift className="w-2.5 h-2.5 text-purple-600" />
              Forgiveness
            </span>
          )}
          {isCash && expense.amount < 0 && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center gap-1">
              <ArrowDownLeft className="w-2.5 h-2.5 text-emerald-600" />
              Received
            </span>
          )}
          {isCash && expense.amount > 0 && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200/60 flex items-center gap-1">
              <ArrowUpRight className="w-2.5 h-2.5 text-rose-600" />
              Paid
            </span>
          )}
        </div>
        <p className="text-xs text-slate-700 font-medium mt-1 truncate">
          {expense.itemName || 'Settlement Entry'}
        </p>
        <p className="text-[10px] text-slate-400 mt-0.5">
          {formatDebtDate(expense.timestamp)}
          {expense.paidWith && ` · ${expense.paidWith}`}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <div className="text-right">
          <p
            className={cn(
              'text-xs font-mono font-bold',
              isOffset
                ? 'text-amber-700'
                : isForgive
                  ? 'text-purple-700'
                  : expense.amount < 0
                    ? 'text-emerald-600'
                    : 'text-rose-600'
            )}
          >
            {isOffset || isForgive
              ? format(Math.abs(expense.amountInALL || expense.amount))
              : `${expense.amount < 0 ? '+' : '−'}${format(Math.abs(expense.amountInALL || expense.amount))}`}
          </p>
          <p className="text-[9px] text-slate-400">counter-entry</p>
        </div>

        <button
          type="button"
          onClick={() => onDelete(expense)}
          className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
          title="Delete settlement entry"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

const LedgerItemRow: React.FC<{
  debt: DebtRecord;
  onDelete: (debt: DebtRecord) => void;
  onReopen: (debt: DebtRecord) => void;
}> = ({ debt, onDelete, onReopen }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editNote, setEditNote] = useState(debt.note || '');
  const [editAmount, setEditAmount] = useState(String(debt.amountALL));

  const { format } = useCurrency();
  const owedToMe = debt.direction === 'OwedToMe';
  const isResolved = debt.status === 'resolved';

  const handleSave = async () => {
    const val = parseFloat(editAmount);
    if (Number.isNaN(val) || val <= 0) return;
    await updateDebt(debt.id, {
      amountALL: val,
      remainingALL: isResolved ? 0 : Math.min(debt.remainingALL, val),
      note: editNote.trim() || undefined,
    });
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="p-2.5 rounded-xl bg-indigo-50/60 border border-indigo-200 space-y-2 text-xs font-sans">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-indigo-900">Edit Entry</span>
          <button onClick={() => setIsEditing(false)} className="text-slate-400 hover:text-slate-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <input
            type="number"
            step="any"
            value={editAmount}
            onChange={(e) => setEditAmount(e.target.value)}
            className="px-2 py-1 rounded-lg bg-white border border-slate-200 font-mono text-xs"
          />
          <input
            type="text"
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder="Note"
            className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-xs"
          />
        </div>
        <div className="flex justify-end gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="px-2 py-0.5 rounded-md border border-slate-200 bg-white text-slate-600 text-[11px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-2 py-0.5 rounded-md bg-indigo-600 text-white font-semibold text-[11px]"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'p-2.5 rounded-xl border flex items-center justify-between gap-2.5 font-sans transition-colors',
        isResolved ? 'bg-slate-50/60 border-slate-200/80 opacity-70' : 'bg-white border-slate-200/80 shadow-2xs'
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={cn(
              'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md flex items-center gap-1',
              owedToMe
                ? isResolved
                  ? 'bg-slate-100 text-slate-500'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                : isResolved
                  ? 'bg-slate-100 text-slate-500'
                  : 'bg-rose-50 text-rose-700 border border-rose-200/60'
            )}
          >
            {owedToMe ? <ArrowUpRight className="w-2.5 h-2.5 text-emerald-600" /> : <ArrowDownLeft className="w-2.5 h-2.5 text-rose-600" />}
            {owedToMe ? 'Owed to you' : 'You owed'}
          </span>
          {isResolved && (
            <span className="text-[9px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md">
              Balanced
            </span>
          )}
        </div>
        {debt.note && <p className="text-xs text-slate-700 font-medium mt-1 truncate">{debt.note}</p>}
        <p className="text-[10px] text-slate-400 mt-0.5">
          {formatDebtDate(debt.createdAt)}
          {isResolved && debt.resolvedAt && ` · Settled ${formatDebtDate(debt.resolvedAt)}`}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <div className="text-right">
          <p
            className={cn(
              'text-xs font-mono font-bold',
              isResolved ? 'text-slate-400 line-through' : owedToMe ? 'text-emerald-600' : 'text-rose-600'
            )}
          >
            {format(debt.amountALL)}
          </p>
          {!isResolved && debt.remainingALL !== debt.amountALL && (
            <p className="text-[9px] font-mono text-slate-400">bal: {format(debt.remainingALL)}</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
          title="Edit entry"
        >
          <Pencil className="w-3 h-3" />
        </button>
        {isResolved && (
          <button
            type="button"
            onClick={() => onReopen(debt)}
            className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
            title="Reopen entry"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(debt)}
          className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
          title="Delete entry"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

interface SettlementControlsProps {
  groupName: string;
  amount: string;
  onAmountChange: (v: string) => void;
  direction: 'inflow' | 'outflow';
  onDirectionChange: (d: 'inflow' | 'outflow') => void;
  disabled: boolean;
  onMethod: (method: PaymentSource | 'offset') => void;
  onForgive: () => void;
  canForgive: boolean;
}

const SettlementControls: React.FC<SettlementControlsProps> = ({
  groupName,
  amount,
  onAmountChange,
  direction,
  onDirectionChange,
  disabled,
  onMethod,
  onForgive,
  canForgive,
}) => {
  const parsed = parseFloat(amount);
  const amountNum = !Number.isNaN(parsed) && parsed > 0 ? parsed : 0;
  const canAct = !disabled && amountNum > 0;
  const isInflow = direction === 'inflow';

  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
          Settle with {groupName}
        </p>
        <p className="text-[9px] text-slate-400 italic">tap a method to apply</p>
      </div>

      <div className="grid grid-cols-2 gap-1 p-0.5 rounded-xl bg-slate-100/70 border border-slate-200/60">
        <button
          type="button"
          onClick={() => onDirectionChange('inflow')}
          disabled={disabled}
          className={cn(
            'flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50',
            isInflow
              ? 'bg-white text-emerald-700 shadow-2xs border border-emerald-200/70'
              : 'text-slate-500 hover:text-slate-700'
          )}
        >
          <ArrowDownLeft className={cn('w-3 h-3', isInflow ? 'text-emerald-600' : 'text-slate-400')} />
          They paid me
        </button>
        <button
          type="button"
          onClick={() => onDirectionChange('outflow')}
          disabled={disabled}
          className={cn(
            'flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50',
            !isInflow
              ? 'bg-white text-rose-700 shadow-2xs border border-rose-200/70'
              : 'text-slate-500 hover:text-slate-700'
          )}
        >
          <ArrowUpRight className={cn('w-3 h-3', !isInflow ? 'text-rose-600' : 'text-slate-400')} />
          I paid them
        </button>
      </div>

      <div className="flex items-baseline justify-center gap-1.5 py-1">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0"
          className={cn(
            'w-32 bg-transparent text-right font-mono font-extrabold text-2xl tabular-nums placeholder:text-slate-300 focus:outline-none transition-colors',
            amountNum > 0
              ? isInflow
                ? 'text-emerald-700'
                : 'text-rose-700'
              : 'text-slate-900'
          )}
        />
        <span className="text-[11px] font-mono font-bold text-slate-400">ALL</span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => onMethod('Cash')}
          disabled={!canAct}
          className="py-2 rounded-xl bg-slate-50 hover:bg-slate-100 active:scale-[0.97] border border-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer flex flex-col items-center gap-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          <Banknote className="w-4 h-4 text-teal-600" />
          Cash
        </button>
        <button
          type="button"
          onClick={() => onMethod('Card')}
          disabled={!canAct}
          className="py-2 rounded-xl bg-slate-50 hover:bg-slate-100 active:scale-[0.97] border border-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer flex flex-col items-center gap-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          <Wallet className="w-4 h-4 text-indigo-600" />
          Bank
        </button>
        <button
          type="button"
          onClick={() => onMethod('offset')}
          disabled={!canAct}
          className="py-2 rounded-xl bg-slate-50 hover:bg-slate-100 active:scale-[0.97] border border-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer flex flex-col items-center gap-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          <ArrowRightLeft className="w-4 h-4 text-amber-600" />
          Offset
        </button>
      </div>

      <div className="flex justify-end pt-0.5">
        <button
          type="button"
          onClick={onForgive}
          disabled={!canForgive || !canAct}
          className="text-[10px] font-semibold text-amber-700/80 hover:text-amber-800 cursor-pointer flex items-center gap-1 px-1 py-0.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Forgive the entered amount"
        >
          <Gift className="w-3 h-3" />
          Forgive this amount
        </button>
      </div>
    </div>
  );
};

export const DebtsPanel: React.FC<DebtsPanelProps> = ({ isOpen, onClose, initialCounterparty }) => {
  const { debts, totalOwedToMe, totalIOwe, netBalance } = useDebts();
  const { expenses } = useExpenses();
  const [showNewForm, setShowNewForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [amountMap, setAmountMap] = useState<Record<string, string>>({});
  const [directionMap, setDirectionMap] = useState<Record<string, 'inflow' | 'outflow'>>({});
  const [busyPerson, setBusyPerson] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { format } = useCurrency();
  const convexGroups = useQuery((api as any).groups?.getMyGroups || (api as any).groups?.listGroups, {});

  const groups = useMemo<CounterpartyGroup[]>(() => {
    const map = new Map<string, CounterpartyGroup>();
    const q = searchQuery.trim().toLowerCase();

    for (const d of debts) {
      if (q) {
        const matchesName = d.counterparty.toLowerCase().includes(q);
        const matchesNote = (d.note || '').toLowerCase().includes(q);
        if (!matchesName && !matchesNote) continue;
      }

      let g = map.get(d.counterpartyKey);
      if (!g) {
        g = {
          key: d.counterpartyKey,
          name: d.counterparty,
          openDebts: [],
          resolvedDebts: [],
          receivables: 0,
          payables: 0,
        };
        map.set(d.counterpartyKey, g);
      }
      if (d.status === 'open') {
        g.openDebts.push(d);
        if (d.direction === 'OwedToMe') g.receivables += d.remainingALL;
        else g.payables += d.remainingALL;
      } else {
        g.resolvedDebts.push(d);
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const aNet = Math.abs(a.receivables - a.payables);
      const bNet = Math.abs(b.receivables - b.payables);
      if (aNet !== bNet) return bNet - aNet;
      return a.name.localeCompare(b.name);
    });
  }, [debts, searchQuery]);

  // Handle panel opening and targeted counterparty auto-scrolling
  useEffect(() => {
    if (isOpen) {
      if (typeof initialCounterparty === 'string' && initialCounterparty.trim().length > 0) {
        const targetStr = initialCounterparty.trim().toLowerCase();
        const match = groups.find(
          (g) => g.key === targetStr || g.name.trim().toLowerCase() === targetStr
        );
        const targetKey = match ? match.key : targetStr;
        setExpandedKey(targetKey);
        setTimeout(() => {
          cardRefs.current[targetKey]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
      } else {
        setExpandedKey(null);
      }
    }
  }, [isOpen, initialCounterparty]);

  const applyFlow = async (
    g: CounterpartyGroup,
    flow: 'inflow' | 'outflow',
    method: PaymentSource | 'offset'
  ) => {
    const raw = amountMap[g.key];
    const parsed = parseFloat(raw ?? '');
    const amount = !Number.isNaN(parsed) && parsed > 0 ? parsed : 0;
    if (amount <= 0) return;

    setBusyPerson(g.key);

    const sortedOpen = [...g.openDebts].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    let remainingToApply = amount;
    const paydownDirection: DebtDirection = flow === 'inflow' ? 'OwedToMe' : 'iOwe';
    const growDirection: DebtDirection = flow === 'inflow' ? 'iOwe' : 'OwedToMe';

    for (const d of sortedOpen) {
      if (remainingToApply <= 0) break;
      if (d.direction !== paydownDirection) continue;

      const settleAmt = Math.min(d.remainingALL, remainingToApply);
      if (settleAmt <= 0) continue;

      if (method === 'offset') {
        const dir: 'iOweMore' | 'theyOweMore' =
          d.direction === 'OwedToMe' ? 'iOweMore' : 'theyOweMore';
        await settleDebtOffset(d.id, settleAmt, dir);
      } else {
        await settleDebtCash(d.id, settleAmt, method);
      }
      remainingToApply -= settleAmt;
    }

    if (remainingToApply > 0) {
      const growTargets = sortedOpen.filter((d) => d.direction === growDirection);
      if (growTargets.length > 0) {
        for (const d of growTargets) {
          if (remainingToApply <= 0) break;
          const dir: 'iOweMore' | 'theyOweMore' =
            d.direction === 'iOwe' ? 'iOweMore' : 'theyOweMore';
          await settleDebtOffset(d.id, remainingToApply, dir);
          remainingToApply = 0;
        }
      } else {
        await addDebt({
          counterparty: g.name,
          direction: growDirection,
          amountALL: remainingToApply,
          note: method === 'offset' ? 'Offset' : `${flow === 'inflow' ? 'Received' : 'Paid'} (${method})`,
        });
        remainingToApply = 0;
      }
    }

    setBusyPerson(null);
    setAmountMap((prev) => ({ ...prev, [g.key]: '' }));
  };

  const handleForgive = async (g: CounterpartyGroup) => {
    const raw = amountMap[g.key];
    const parsed = parseFloat(raw ?? '');
    const requested = !Number.isNaN(parsed) && parsed > 0 ? parsed : 0;
    if (requested <= 0) return;

    const totalOpen = g.receivables + g.payables;
    if (totalOpen <= 0) return;

    const amount = Math.min(requested, totalOpen);
    setBusyPerson(g.key);

    const sortedOpen = [...g.openDebts].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    let remaining = amount;
    for (const d of sortedOpen) {
      if (remaining <= 0) break;
      const slice = Math.min(d.remainingALL, remaining);

      if (slice >= d.remainingALL) {
        await writeOffDebt(d.id);
      } else {
        const isIOwe = d.direction === 'iOwe';
        const baseName = isIOwe
          ? `Forgiven by ${d.counterparty}`
          : `Forgiven to ${d.counterparty}`;
        const itemName = d.note ? `${baseName} (${d.note})` : baseName;

        await db.expenses.add({
          id: crypto.randomUUID(),
          amount: isIOwe ? -slice : slice,
          currency: 'ALL',
          amountInALL: slice,
          category: 'Other',
          itemName,
          timestamp: new Date().toISOString(),
          isSynced: false,
          updatedAt: new Date().toISOString(),
          walletNeutral: true,
          isForgiveness: true,
          debtId: d.id,
        });

        const newRemaining = d.remainingALL - slice;
        await db.debts.update(d.id, {
          remainingALL: newRemaining,
          status: newRemaining <= 0 ? 'resolved' : 'open',
          resolvedAt: newRemaining <= 0 ? new Date().toISOString() : undefined,
          isSynced: false,
          updatedAt: new Date().toISOString(),
        });
      }

      remaining -= slice;
    }

    setBusyPerson(null);
    setAmountMap((prev) => ({ ...prev, [g.key]: '' }));
  };

  const handleDeleteDebt = async (debt: DebtRecord) => {
    const isLinked = await hasLinkedExpenses(debt);
    if (isLinked) {
      setConfirm({
        isOpen: true,
        title: 'Delete linked transaction as well?',
        message:
          'This debt is linked to a budget transaction. Deleting it will clean up both records and revert wallet movements.',
        confirmLabel: 'Delete Both Records',
        onConfirm: async () => {
          await deleteDebt(debt.id);
        },
      });
      return;
    }
    await deleteDebt(debt.id);
  };

  const handleDeleteExpense = async (expense: ExpenseRecord) => {
    setConfirm({
      isOpen: true,
      title: 'Delete settlement entry?',
      message:
        'This will remove the counter-entry from your transaction feed and restore the debt balance.',
      confirmLabel: 'Delete Entry',
      onConfirm: async () => {
        await deleteExpense(expense.id);
      },
    });
  };

  const handleReopenDebt = async (debt: DebtRecord) => {
    await db.debts.update(debt.id, {
      status: 'open',
      resolvedAt: undefined,
      updatedAt: new Date().toISOString(),
    });
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-5 bg-slate-900/40 backdrop-blur-xs animate-in fade-in"
      onClick={onClose}
    >
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />

      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-white border border-slate-200/90 rounded-3xl shadow-xl overflow-hidden font-sans my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4.5 pt-3.5 pb-2.5 border-b border-slate-100 shrink-0 bg-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
              <HandCoins className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Debts & Running Ledgers</h2>
              <p className="text-[10px] text-slate-400">Continuous balance tracking by person</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4.5 pt-3 shrink-0">
          <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 border border-slate-200/80 shadow-2xs flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Net Position</p>
              <p
                className={cn(
                  'text-xl font-mono font-extrabold mt-0.5',
                  netBalance > 0 ? 'text-emerald-600' : netBalance < 0 ? 'text-rose-600' : 'text-slate-700'
                )}
              >
                {netBalance > 0 ? '+' : ''}
                {format(netBalance)}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {netBalance > 0 ? 'Net Receivable (Owed to you)' : netBalance < 0 ? 'Net Payable (You owe)' : 'Balanced overall'}
              </p>
            </div>

            <div className="space-y-1 text-right">
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200/60 text-emerald-700 text-xs font-mono font-bold">
                <ArrowUpRight className="w-3 h-3 text-emerald-600" />
                +{format(totalOwedToMe)}
              </div>
              <br />
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-50 border border-rose-200/60 text-rose-700 text-xs font-mono font-bold">
                <ArrowDownLeft className="w-3 h-3 text-rose-600" />
                -{format(totalIOwe)}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4.5 pt-2.5 pb-2 flex items-center justify-between gap-2 shrink-0">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search person or note..."
              className="w-full bg-slate-50 border border-slate-200/80 rounded-xl pl-7 pr-2.5 py-1 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowNewForm((prev) => !prev)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer transition-colors shadow-2xs shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showNewForm ? 'Close' : 'New Entry'}</span>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4.5 pb-4 space-y-2.5 touch-pan-y">
          {showNewForm && (
            <NewDebtForm
              onSaved={() => {
                setShowNewForm(false);
              }}
            />
          )}

          {groups.length === 0 ? (
            <div className="text-center py-10 px-4 rounded-2xl bg-slate-50/50 border border-slate-200/80 border-dashed space-y-1.5">
              <Sparkles className="w-6 h-6 text-indigo-400 mx-auto" />
              <p className="text-xs font-bold text-slate-700">All even!</p>
              <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                No active balances. Tap "New Entry" above to add a transaction.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {groups.map((g) => {
                const isExpanded = expandedKey === g.key;
                const net = g.receivables - g.payables;
                const isBusy = busyPerson === g.key;
                const hasOpen = g.openDebts.length > 0;
                const currentDirection =
                  directionMap[g.key] ?? (net < 0 ? 'outflow' : 'inflow');

                // Build unified feed items for this counterparty (both DebtRecords and linked counter-entries)
                const allPersonDebts = [...g.openDebts, ...g.resolvedDebts];
                const personDebtIds = new Set(allPersonDebts.map((d) => d.id));
                const personSourceExpenseIds = new Set(
                  allPersonDebts
                    .map((d) => d.sourceExpenseId)
                    .filter((id): id is string => Boolean(id))
                );

                const matchingExpenses = expenses.filter((e) => {
                  if (e.deleted || e.isDebtOrigin) return false;
                  if (personSourceExpenseIds.has(e.id)) return false;

                  const itemLower = (e.itemName || '').trim().toLowerCase();
                  if (itemLower.startsWith('bought by ')) return false;

                  const isCounterEntry =
                    Boolean(e.debtRelated) ||
                    Boolean(e.walletNeutral) ||
                    Boolean(e.isForgiveness) ||
                    (e.category as string) === 'Offset' ||
                    itemLower.includes('offset') ||
                    itemLower.includes('repaid') ||
                    itemLower.includes('repayment') ||
                    itemLower.includes('payment to') ||
                    itemLower.includes('forgiven');

                  if (e.debtId && personDebtIds.has(e.debtId)) {
                    return isCounterEntry;
                  }

                  if (e.itemName) {
                    const nameLower = g.name.toLowerCase();
                    if (isCounterEntry && itemLower.includes(nameLower)) {
                      return true;
                    }
                  }
                  return false;
                });

                const feedItems: FeedItem[] = [
                  ...g.openDebts.map((d) => ({
                    id: `debt-${d.id}`,
                    type: 'debt' as const,
                    data: d,
                    timestamp: d.createdAt,
                  })),
                  ...g.resolvedDebts.map((d) => ({
                    id: `debt-${d.id}`,
                    type: 'debt' as const,
                    data: d,
                    timestamp: d.createdAt,
                  })),
                  ...matchingExpenses.map((e) => ({
                    id: `exp-${e.id}`,
                    type: 'expense' as const,
                    data: e,
                    timestamp: e.timestamp,
                  })),
                ].sort(
                  (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                );

                const numEntries = feedItems.length;
                const entryText = numEntries === 1 ? '1 entry' : `${numEntries} entries`;

                return (
                  <div
                    key={g.key}
                    ref={(el) => {
                      cardRefs.current[g.key] = el;
                    }}
                    className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-2xs"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedKey(isExpanded ? null : g.key)}
                      className="w-full flex items-center justify-between p-3 text-left cursor-pointer hover:bg-slate-50/60 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-indigo-700">
                            {g.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{g.name}</p>
                          <p className="text-[10px] text-slate-400">{entryText}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="text-right">
                          <p
                            className={cn(
                              'text-xs font-mono font-bold',
                              net > 0 ? 'text-emerald-600' : net < 0 ? 'text-rose-600' : 'text-slate-400'
                            )}
                          >
                            {net === 0 ? 'Balanced' : `${net > 0 ? '+' : '−'}${format(Math.abs(net))}`}
                          </p>
                          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                            {net > 0 ? 'owes you' : net < 0 ? 'you owe' : 'settled'}
                          </p>
                        </div>
                        <ChevronDown
                          className={cn(
                            'w-3.5 h-3.5 text-slate-400 transition-transform duration-200',
                            isExpanded && 'rotate-180'
                          )}
                        />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1.5 space-y-2.5 border-t border-slate-100 bg-slate-50/40">
                        {hasOpen && (
                          <SettlementControls
                            groupName={g.name}
                            amount={amountMap[g.key] ?? ''}
                            onAmountChange={(v) =>
                              setAmountMap((prev) => ({ ...prev, [g.key]: v }))
                            }
                            direction={currentDirection}
                            onDirectionChange={(d) =>
                              setDirectionMap((prev) => ({ ...prev, [g.key]: d }))
                            }
                            disabled={isBusy}
                            onMethod={(method) => applyFlow(g, currentDirection, method)}
                            onForgive={() => handleForgive(g)}
                            canForgive={g.receivables + g.payables > 0}
                          />
                        )}

                        <div className="space-y-1.5">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pt-0.5">
                            Transaction Feed
                          </p>
                          {feedItems.map((item) => {
                            if (item.type === 'debt') {
                              return (
                                <LedgerItemRow
                                  key={item.id}
                                  debt={item.data}
                                  onDelete={handleDeleteDebt}
                                  onReopen={handleReopenDebt}
                                />
                              );
                            }
                            return (
                              <SettlementExpenseRow
                                key={item.id}
                                expense={item.data}
                                onDelete={handleDeleteExpense}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {Array.isArray(convexGroups) && convexGroups.length > 0 && (
                <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Shared Trip & Group Balances (Divvy)
                  </p>
                  {convexGroups.map((cg: any) => {
                    const grpCurrency = (cg.currency || 'ALL').toUpperCase() as Currency;
                    const netALL = cg.myNetBalanceALL ?? cg.netBalanceALL ?? cg.netBalance ?? 0;
                    const netGroup =
                      typeof cg.myNetBalanceGroup === 'number'
                        ? cg.myNetBalanceGroup
                        : convertFromALL(netALL, grpCurrency);

                    return (
                      <div
                        key={cg._id}
                        className="p-2.5 rounded-xl border border-slate-200/80 bg-white shadow-2xs flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200/60 flex items-center justify-center text-xs font-bold">
                            👥
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-900 text-xs">{cg.name}</h4>
                            <p className="text-[9px] text-slate-400 font-mono">
                              ID: {cg.inviteCode || cg._id.slice(-6).toUpperCase()} · {grpCurrency}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <p
                            className={cn(
                              'text-xs font-mono font-bold',
                              netGroup > 0
                                ? 'text-emerald-600'
                                : netGroup < 0
                                  ? 'text-rose-600'
                                  : 'text-slate-400'
                            )}
                          >
                            {netGroup === 0
                              ? 'Settled'
                              : `${netGroup > 0 ? '+' : '−'}${formatCurrency(Math.abs(netGroup), grpCurrency)}`}
                          </p>
                          {grpCurrency !== 'ALL' && netALL !== 0 && (
                            <p className="text-[9px] font-mono text-slate-400">
                              ≈ {format(Math.abs(netALL))}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};