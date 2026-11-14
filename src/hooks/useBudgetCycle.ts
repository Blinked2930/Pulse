// src/hooks/useBudgetCycle.ts
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useQuery } from 'convex/react';
import { useUser } from '@clerk/clerk-react';
import { api } from '../../convex/_generated/api';
import { getCurrentBudgetCycle } from '../db';
import { useExpenses } from './useExpenses';
import { useTransfers } from './useTransfers';
import { useDebts } from './useDebts';
import { computeBudgetStats, snapshotFromGroups } from '../utils/budget';
import { buildCycleRollup, type BridgeGroupDetails } from '../utils/divvyBridge';

export function useBudgetCycle() {
    const { user } = useUser();
    const { expenses } = useExpenses();
    const { transfers } = useTransfers();
    const { openDebts } = useDebts();

    const cycleResult = useLiveQuery(
        async () => (await getCurrentBudgetCycle()) ?? null,
        []
    );

    const myGroups = useQuery((api as any).groups?.getMyGroups, {}) || [];
    const allGroupDetails = (useQuery((api as any).groups?.getAllMyGroupDetails, {}) || []) as BridgeGroupDetails[];

    const prefs = useQuery((api as any).preferences?.getMyPreferences, {}) as
        | { baseCurrency: string }
        | undefined;
    const baseCurrency: string = prefs?.baseCurrency ?? 'ALL';

    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 60_000);
        return () => clearInterval(id);
    }, []);

    const cycle = cycleResult ?? null;

    const divvyRollup = useMemo(() => {
        if (!cycle) return null;
        const cycleStartMs = new Date(cycle.startDate).getTime();
        const displayNames = [
            user?.fullName ?? '',
            user?.firstName ?? '',
            user?.username ?? '',
            'You',
            'Me',
        ].filter(Boolean);

        // Normalize member records so legacy "anonymous" creator records match the signed-in user
        const normalizedDetails: BridgeGroupDetails[] = allGroupDetails.map((gd) => {
            const hasExactUser = user?.id && gd.members.some((m: any) => m.userId === user.id);
            if (hasExactUser || !user?.id) return gd;
            const anonIdx = gd.members.findIndex((m: any) => !m.userId || m.userId === 'anonymous');
            if (anonIdx === -1) return gd;
            return {
                ...gd,
                members: gd.members.map((m: any, idx: number) =>
                    idx === anonIdx ? { ...m, userId: user.id } : m
                ),
            };
        });

        return buildCycleRollup({
            groupSummaries: myGroups,
            groupDetailsList: normalizedDetails,
            cycleStartMs: Number.isFinite(cycleStartMs) ? cycleStartMs : 0,
            clerkUserId: user?.id ?? 'anonymous',
            displayNames,
        });
    }, [cycle, myGroups, allGroupDetails, user?.id, user?.fullName, user?.firstName, user?.username]);

    const divvySnapshot = useMemo(() => {
        const base = snapshotFromGroups(myGroups);
        if (!divvyRollup) return base;
        return {
            ...base,
            walletDeltaALL: divvyRollup.walletDeltaALL,
            walletCardDeltaALL: divvyRollup.walletCardDeltaALL,
            walletCashDeltaALL: divvyRollup.walletCashDeltaALL,
            regularBudgetSpendALL: divvyRollup.totalMyRegularBudgetShareALL,
            bigExpenseSpendALL: divvyRollup.totalMyBigExpenseShareALL,
            travelSpendALL: divvyRollup.totalMyTravelShareALL,
            virtualExpenses: divvyRollup.virtualExpenses,
            rollup: divvyRollup,
        };
    }, [myGroups, divvyRollup]);

    const stats = useMemo(
        () =>
            cycle
                ? computeBudgetStats(cycle, expenses, transfers, openDebts, divvySnapshot, now)
                : null,
        [cycle, expenses, transfers, openDebts, divvySnapshot, now]
    );

    return { cycle, stats, divvyRollup, baseCurrency, isLoading: cycleResult === undefined };
}