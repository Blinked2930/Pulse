// convex/groups.ts
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const FALLBACK_RATES_TO_ALL: Record<string, number> = {
  ALL: 1,
  EUR: 100,
  USD: 90,
  GBP: 118,
  CHF: 105,
  CAD: 68,
  AUD: 60,
  JPY: 0.62,
};

function assertValidCurrencyCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error(`Invalid currency code: "${code}". Expected a 3-letter ISO code.`);
  }
  return normalized;
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function allocateByShares(
  totalAmount: number,
  weights: Record<string, number>
): Record<string, number> {
  const ids = Object.keys(weights).filter((id) => (weights[id] ?? 0) > 0);
  if (ids.length === 0) return {};
  const sign = totalAmount < 0 ? -1 : 1;
  const totalCents = Math.round(Math.abs(totalAmount) * 100);
  if (totalCents === 0) {
    const zeros: Record<string, number> = {};
    for (const id of ids) zeros[id] = 0;
    return zeros;
  }
  const totalWeight = ids.reduce((s, id) => s + weights[id], 0);
  if (totalWeight <= 0) return {};
  const floors: Record<string, number> = {};
  const remainders: Array<{ id: string; rem: number }> = [];
  let allocatedCents = 0;
  for (const id of ids) {
    const exact = (totalCents * weights[id]) / totalWeight;
    const floor = Math.floor(exact);
    floors[id] = floor;
    allocatedCents += floor;
    remainders.push({ id, rem: exact - floor });
  }
  let leftover = totalCents - allocatedCents;
  remainders.sort((a, b) => (b.rem !== a.rem ? b.rem - a.rem : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 0; i < remainders.length && leftover > 0; i++, leftover--) {
    floors[remainders[i].id] += 1;
  }
  const result: Record<string, number> = {};
  for (const id of ids) result[id] = (floors[id] * sign) / 100;
  return result;
}

function assertSplitsBalance(splits: Array<{ amountALL: number }>, amountInALL: number): void {
  const sum = splits.reduce((s, x) => s + (x.amountALL ?? 0), 0);
  const diff = Math.abs(sum - amountInALL);
  if (diff > 0.01) {
    throw new Error(
      `Split amounts do not sum to the expense total. Sum=${sum.toFixed(2)}, expected=${amountInALL.toFixed(2)}, off by ${diff.toFixed(2)}.`
    );
  }
}

function assertGroupSplitsBalance(
  splits: Array<{ amountGroup?: number }>,
  amountInGroupCurrency: number
): void {
  const hasGroupAmounts = splits.some((s) => typeof s.amountGroup === "number");
  if (!hasGroupAmounts) return;
  const sum = splits.reduce((s, x) => s + (x.amountGroup ?? 0), 0);
  const diff = Math.abs(sum - amountInGroupCurrency);
  if (diff > 0.01) {
    throw new Error(
      `Group split amounts do not sum to the group total. Sum=${sum.toFixed(2)}, expected=${amountInGroupCurrency.toFixed(2)}, off by ${diff.toFixed(2)}.`
    );
  }
}

function resolveGroupAmount(
  amount: number,
  currency: string,
  amountInALL: number,
  groupCurrency: string,
  explicitGroupAmount?: number
): number {
  if (currency === groupCurrency) {
    return Math.round(amount * 100) / 100;
  }
  if (groupCurrency === "ALL") {
    return Math.round(amountInALL * 100) / 100;
  }
  if (
    typeof explicitGroupAmount === "number" &&
    Number.isFinite(explicitGroupAmount) &&
    explicitGroupAmount > 0 &&
    Math.abs(explicitGroupAmount - amountInALL) > 0.01
  ) {
    return Math.round(explicitGroupAmount * 100) / 100;
  }
  const groupRateToALL = FALLBACK_RATES_TO_ALL[groupCurrency] ?? 100;
  return Math.round((amountInALL / groupRateToALL) * 100) / 100;
}

function ensureSplitsHaveGroupAmounts(
  splits: Array<{ memberId: any; userId?: string; amountGroup?: number; amountALL: number }>,
  amountInGroupCurrency: number
): Array<{ memberId: any; userId?: string; amountGroup: number; amountALL: number }> {
  const hasAllGroupAmounts = splits.every(
    (s) => typeof s.amountGroup === "number" && Number.isFinite(s.amountGroup)
  );
  if (hasAllGroupAmounts) {
    const sum = splits.reduce((acc, s) => acc + (s.amountGroup ?? 0), 0);
    if (Math.abs(sum - amountInGroupCurrency) <= 0.01) {
      return splits.map((s) => ({
        ...s,
        amountGroup: Math.round((s.amountGroup ?? 0) * 100) / 100,
      }));
    }
  }
  const weights: Record<string, number> = {};
  for (const s of splits) {
    weights[s.memberId] = s.amountALL > 0 ? s.amountALL : 0;
  }
  const alloc = allocateByShares(amountInGroupCurrency, weights);
  return splits.map((s) => ({
    ...s,
    amountGroup: alloc[s.memberId] ?? 0,
  }));
}

function rebalanceSplits(
  existing: Array<{ memberId: any; userId?: string; amountGroup?: number; amountALL: number }>,
  amountInALL: number
): Array<{ memberId: any; userId?: string; amountGroup?: number; amountALL: number }> {
  const positives = existing.filter((s) => s.amountALL > 0);
  if (positives.length === 0) {
    const weights: Record<string, number> = {};
    for (const s of existing) weights[s.memberId] = 1;
    const alloc = allocateByShares(amountInALL, weights);
    return existing.map((s) => ({ ...s, amountALL: alloc[s.memberId] ?? 0 }));
  }
  const minAmt = Math.min(...positives.map((s) => s.amountALL));
  const weights: Record<string, number> = {};
  for (const s of existing) {
    if (s.amountALL <= 0) {
      weights[s.memberId] = 0;
      continue;
    }
    weights[s.memberId] = Math.max(1, Math.round(s.amountALL / minAmt));
  }
  const alloc = allocateByShares(amountInALL, weights);
  return existing.map((s) => ({ ...s, amountALL: alloc[s.memberId] ?? 0 }));
}

// ---------------------------------------------------------------------------
// QUERIES
// ---------------------------------------------------------------------------

export const getMyGroups = query({
  args: {
    userId: v.optional(v.string()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? args.userId ?? "anonymous";

    const allMembers = await ctx.db.query("groupMembers").collect();
    const myMemberRecords = allMembers.filter(
      (m) => m.userId === userId || !m.userId || m.userId === "anonymous"
    );

    const groups: any[] = [];
    const seenGroupIds = new Set<string>();

    for (const memberRow of myMemberRecords) {
      const gidStr = String(memberRow.groupId);
      if (seenGroupIds.has(gidStr)) continue;

      const group = await ctx.db.get(memberRow.groupId);
      if (!group || group.deleted) continue;

      const groupStatus = group.status ?? "active";
      if (!args.includeArchived && groupStatus === "archived") continue;

      const members = await ctx.db
        .query("groupMembers")
        .filter((q) => q.eq(q.field("groupId"), memberRow.groupId))
        .collect();

      const selfMember =
        members.find((m) => m.userId === userId) ??
        members.find((m) => !m.userId || m.userId === "anonymous");
      if (!selfMember) continue;

      seenGroupIds.add(gidStr);

      const expenses = await ctx.db
        .query("groupExpenses")
        .filter((q) =>
          q.and(
            q.eq(q.field("groupId"), memberRow.groupId),
            q.neq(q.field("deleted"), true)
          )
        )
        .collect();

      const settlements = await ctx.db
        .query("groupSettlements")
        .filter((q) =>
          q.and(
            q.eq(q.field("groupId"), memberRow.groupId),
            q.neq(q.field("deleted"), true)
          )
        )
        .collect();

      let netALL = 0;
      let netGroup = 0;

      for (const exp of expenses) {
        const expGroupTotal = resolveGroupAmount(
          exp.amount,
          exp.currency,
          exp.amountInALL,
          group.currency,
          exp.amountInGroupCurrency
        );

        if (exp.paidByMemberId === selfMember._id) {
          netALL += exp.amountInALL;
          netGroup += expGroupTotal;
        }
        for (const split of exp.splits) {
          if (split.memberId === selfMember._id) {
            netALL -= split.amountALL;
            const splitGroupAmt =
              exp.currency === group.currency && exp.amountInALL > 0
                ? (split.amountALL / exp.amountInALL) * exp.amount
                : group.currency === "ALL"
                  ? split.amountALL
                  : typeof split.amountGroup === "number" &&
                      Math.abs(split.amountGroup - split.amountALL) > 0.01
                    ? split.amountGroup
                    : exp.amountInALL > 0
                      ? (split.amountALL / exp.amountInALL) * expGroupTotal
                      : 0;
            netGroup -= splitGroupAmt;
          }
        }
      }

      for (const set of settlements) {
        const setGroupAmt = resolveGroupAmount(
          set.amount ?? set.amountALL,
          set.currency,
          set.amountALL,
          group.currency,
          set.amountInGroupCurrency
        );

        if (set.fromMemberId === selfMember._id) {
          netALL += set.amountALL;
          netGroup += setGroupAmt;
        }
        if (set.toMemberId === selfMember._id) {
          netALL -= set.amountALL;
          netGroup -= setGroupAmt;
        }
      }

      groups.push({
        ...group,
        status: groupStatus,
        memberCount: members.length,
        myNetBalanceGroup: Math.round(netGroup * 100) / 100,
        myNetBalanceALL: Math.round(netALL * 100) / 100,
        isOwner: group.createdBy === userId,
      });
    }

    return groups.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listGroups = getMyGroups;

export const getGroupDetails = query({
  args: {
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group || group.deleted) {
      return null;
    }

    const members = await ctx.db
      .query("groupMembers")
      .filter((q) => q.eq(q.field("groupId"), args.groupId))
      .collect();

    const expenses = await ctx.db
      .query("groupExpenses")
      .filter((q) =>
        q.and(
          q.eq(q.field("groupId"), args.groupId),
          q.neq(q.field("deleted"), true)
        )
      )
      .collect();

    const settlements = await ctx.db
      .query("groupSettlements")
      .filter((q) =>
        q.and(
          q.eq(q.field("groupId"), args.groupId),
          q.neq(q.field("deleted"), true)
        )
      )
      .collect();

    return {
      group: {
        ...group,
        status: group.status ?? "active",
        allowedCurrencies: (group as any).allowedCurrencies || ["ALL", "EUR", "USD"],
      },
      members,
      expenses: expenses.sort((a, b) => b.timestamp - a.timestamp),
      settlements: settlements.sort((a, b) => b.timestamp - a.timestamp),
    };
  },
});

/**
 * Single reactive subscription returning full group details (members, expenses,
 * settlements) for all groups the current user belongs to. Used by Pulse's
 * useBudgetCycle hook so personal consumption, Card/Cash wallet deltas, Big
 * Expenses, and Travel Stash recalculate immediately when Divvy changes.
 */
export const getAllMyGroupDetails = query({
  args: {
    userId: v.optional(v.string()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? args.userId ?? "anonymous";

    const allMembers = await ctx.db.query("groupMembers").collect();
    const myMemberRecords = allMembers.filter(
      (m) => m.userId === userId || !m.userId || m.userId === "anonymous"
    );

    const results: Array<{
      group: { _id: any; name: string; currency: string; status: string };
      members: any[];
      expenses: any[];
      settlements: any[];
    }> = [];

    const seenGroupIds = new Set<string>();

    for (const memberRow of myMemberRecords) {
      const gidStr = String(memberRow.groupId);
      if (seenGroupIds.has(gidStr)) continue;
      seenGroupIds.add(gidStr);

      const group = await ctx.db.get(memberRow.groupId);
      if (!group || group.deleted) continue;

      const groupStatus = group.status ?? "active";
      if (!args.includeArchived && groupStatus === "archived") continue;

      const members = await ctx.db
        .query("groupMembers")
        .filter((q) => q.eq(q.field("groupId"), memberRow.groupId))
        .collect();

      const expenses = await ctx.db
        .query("groupExpenses")
        .filter((q) =>
          q.and(
            q.eq(q.field("groupId"), memberRow.groupId),
            q.neq(q.field("deleted"), true)
          )
        )
        .collect();

      const settlements = await ctx.db
        .query("groupSettlements")
        .filter((q) =>
          q.and(
            q.eq(q.field("groupId"), memberRow.groupId),
            q.neq(q.field("deleted"), true)
          )
        )
        .collect();

      results.push({
        group: {
          _id: group._id,
          name: group.name,
          currency: group.currency,
          status: groupStatus,
        },
        members,
        expenses: expenses.sort((a, b) => b.timestamp - a.timestamp),
        settlements: settlements.sort((a, b) => b.timestamp - a.timestamp),
      });
    }

    return results;
  },
});

export const checkGroupNameAvailable = query({
  args: {
    name: v.string(),
    excludeGroupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? "anonymous";

    const normalized = normalizeName(args.name);
    if (!normalized) return { available: false, reason: "empty" as const };

    const allGroups = await ctx.db.query("groups").collect();
    const conflict = allGroups.find(
      (g) =>
        !g.deleted &&
        g.createdBy === userId &&
        normalizeName(g.name) === normalized &&
        g._id !== args.excludeGroupId
    );

    return conflict
      ? { available: false, reason: "duplicate" as const, conflictGroupName: conflict.name }
      : { available: true, reason: "ok" as const };
  },
});

export const findCorruptExpenses = query({
  args: {},
  handler: async (ctx) => {
    const expenses = await ctx.db.query("groupExpenses").collect();
    const corrupt: Array<{
      expenseId: any;
      groupId: any;
      title: string;
      amount: number;
      amountInALL: number;
      splitsSum: number;
      diff: number;
      currency: string;
      splitType: string;
      issue: "splits_mismatch" | "unconverted_currency";
    }> = [];
    for (const exp of expenses) {
      if (exp.deleted) continue;
      const sum = exp.splits.reduce((s: number, x: any) => s + (x.amountALL ?? 0), 0);
      const diff = Math.abs(sum - exp.amountInALL);
      if (diff > 0.01) {
        corrupt.push({
          expenseId: exp._id,
          groupId: exp.groupId,
          title: exp.title,
          amount: exp.amount,
          amountInALL: exp.amountInALL,
          splitsSum: sum,
          diff,
          currency: exp.currency,
          splitType: exp.splitType,
          issue: "splits_mismatch",
        });
      } else if (exp.currency !== "ALL" && Math.abs(exp.amountInALL - exp.amount) < 0.001) {
        corrupt.push({
          expenseId: exp._id,
          groupId: exp.groupId,
          title: exp.title,
          amount: exp.amount,
          amountInALL: exp.amountInALL,
          splitsSum: sum,
          diff: 0,
          currency: exp.currency,
          splitType: exp.splitType,
          issue: "unconverted_currency",
        });
      }
    }
    return corrupt;
  },
});

export const getActivityFeed = query({
  args: {
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? args.userId ?? "anonymous";

    const allMembers = await ctx.db.query("groupMembers").collect();
    const memberRecords = allMembers.filter(
      (m) => m.userId === userId || !m.userId || m.userId === "anonymous"
    );

    const groupIds = Array.from(new Set(memberRecords.map((m) => m.groupId)));

    const activities: Array<{
      id: string;
      groupId: string;
      groupName: string;
      groupCurrency: string;
      type: "expense" | "settlement";
      title: string;
      amount: number;
      amountInGroupCurrency?: number;
      amountInALL: number;
      myShareALL?: number;
      youPaid?: boolean;
      currency: string;
      category?: string;
      paidByMemberId?: string;
      splitType?: string;
      paidWith?: "Cash" | "Card";
      isBigExpense?: boolean;
      syncToPulse?: boolean;
      timestamp: number;
      actorName: string;
    }> = [];

    for (const groupId of groupIds) {
      const group = await ctx.db.get(groupId);
      if (!group || group.deleted) continue;

      const members = await ctx.db
        .query("groupMembers")
        .filter((q) => q.eq(q.field("groupId"), groupId))
        .collect();

      const selfMember =
        members.find((m) => m.userId === userId) ??
        members.find((m) => !m.userId || m.userId === "anonymous");
      const memberMap = new Map(members.map((m) => [m._id, m.name]));

      const expenses = await ctx.db
        .query("groupExpenses")
        .filter((q) =>
          q.and(
            q.eq(q.field("groupId"), groupId),
            q.neq(q.field("deleted"), true)
          )
        )
        .collect();

      for (const exp of expenses) {
        const cur = (exp.currency || "ALL").toUpperCase();
        const fallbackRate = FALLBACK_RATES_TO_ALL[cur] ?? 1;
        const isLegacyUnconverted =
          cur !== "ALL" &&
          fallbackRate !== 1 &&
          Math.abs(exp.amountInALL - exp.amount) < 0.001;

        const normalizedAmountInALL = isLegacyUnconverted
          ? Math.round(exp.amount * fallbackRate * 100) / 100
          : exp.amountInALL;

        let myShareALL: number | undefined = undefined;
        if (selfMember) {
          const mySplit = exp.splits.find((s) => s.memberId === selfMember._id);
          const rawShare = mySplit ? mySplit.amountALL : 0;
          myShareALL = isLegacyUnconverted
            ? Math.round(rawShare * fallbackRate * 100) / 100
            : rawShare;
        }

        activities.push({
          id: exp._id,
          groupId: group._id,
          groupName: group.name,
          groupCurrency: group.currency,
          type: "expense",
          title: exp.title,
          amount: exp.amount,
          amountInGroupCurrency: exp.amountInGroupCurrency,
          amountInALL: normalizedAmountInALL,
          myShareALL,
          youPaid: selfMember ? exp.paidByMemberId === selfMember._id : undefined,
          currency: exp.currency,
          category: exp.category,
          paidByMemberId: exp.paidByMemberId,
          splitType: exp.splitType,
          paidWith: exp.paidWith ?? "Card",
          isBigExpense: exp.isBigExpense ?? false,
          syncToPulse: exp.syncToPulse ?? true,
          timestamp: exp.timestamp,
          actorName: memberMap.get(exp.paidByMemberId) ?? "Someone",
        });
      }

      const settlements = await ctx.db
        .query("groupSettlements")
        .filter((q) =>
          q.and(
            q.eq(q.field("groupId"), groupId),
            q.neq(q.field("deleted"), true)
          )
        )
        .collect();

      for (const set of settlements) {
        const fromName = memberMap.get(set.fromMemberId) ?? "Someone";
        const toName = memberMap.get(set.toMemberId) ?? "Someone";
        const cur = (set.currency || "ALL").toUpperCase();
        const fallbackRate = FALLBACK_RATES_TO_ALL[cur] ?? 1;
        const normalizedAmountALL =
          cur !== "ALL" && fallbackRate !== 1 && set.amount === undefined
            ? Math.round(set.amountALL * fallbackRate * 100) / 100
            : set.amountALL;

        activities.push({
          id: set._id,
          groupId: group._id,
          groupName: group.name,
          groupCurrency: group.currency,
          type: "settlement",
          title: `${fromName} paid ${toName}`,
          amount: set.amount ?? set.amountALL,
          amountInGroupCurrency: set.amountInGroupCurrency,
          amountInALL: normalizedAmountALL,
          youPaid: selfMember ? set.fromMemberId === selfMember._id : undefined,
          currency: set.currency,
          paidWith: set.paidWith ?? "Cash",
          timestamp: set.timestamp,
          actorName: fromName,
        });
      }
    }

    return activities.sort((a, b) => b.timestamp - a.timestamp);
  },
});

export const getUnclaimedMembers = query({
  args: {
    groupIdOrCode: v.string(),
  },
  handler: async (ctx, args) => {
    const queryStr = args.groupIdOrCode.trim().toUpperCase();

    const allGroups = await ctx.db.query("groups").collect();
    const group = allGroups.find(
      (g) =>
        !g.deleted &&
        (g._id === args.groupIdOrCode ||
          (g as any).inviteCode?.toUpperCase() === queryStr)
    );

    if (!group) return null;

    const members = await ctx.db
      .query("groupMembers")
      .filter((q) => q.eq(q.field("groupId"), group._id))
      .collect();

    const unclaimedMembers = members.filter(
      (m) => !m.userId || m.userId === "anonymous"
    );

    return {
      groupId: group._id,
      groupName: group.name,
      currency: group.currency,
      inviteCode: (group as any).inviteCode || group._id.slice(-6).toUpperCase(),
      unclaimedMembers: unclaimedMembers.map((m) => ({
        _id: m._id,
        name: m.name,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// MUTATIONS
// ---------------------------------------------------------------------------

export const createGroup = mutation({
  args: {
    name: v.string(),
    currency: v.string(),
    allowedCurrencies: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    memberName: v.string(),
    additionalMembers: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? "anonymous";
    const now = Date.now();
    const inviteCode = generateInviteCode();

    const baseCurrency = assertValidCurrencyCode(args.currency);
    const allowed = Array.from(
      new Set([
        baseCurrency,
        ...(args.allowedCurrencies ?? ["ALL", "EUR", "USD"]).map(assertValidCurrencyCode),
      ])
    );

    const normalized = normalizeName(args.name);
    if (!normalized) {
      throw new Error("Group name cannot be empty.");
    }

    const allGroups = await ctx.db.query("groups").collect();
    const ownedDuplicate = allGroups.find(
      (g) =>
        !g.deleted &&
        g.createdBy === userId &&
        normalizeName(g.name) === normalized
    );
    if (ownedDuplicate) {
      throw new Error(
        `You already own a group called "${ownedDuplicate.name}". Pick a different name.`
      );
    }

    const groupData: {
      name: string;
      currency: string;
      allowedCurrencies: string[];
      description?: string;
      createdBy: string;
      createdAt: number;
      inviteCode: string;
      status: "active" | "archived";
    } = {
      name: args.name.trim(),
      currency: baseCurrency,
      allowedCurrencies: allowed,
      createdBy: userId,
      createdAt: now,
      inviteCode,
      status: "active",
    };

    if (args.description?.trim()) {
      groupData.description = args.description.trim();
    }

    const groupId = await ctx.db.insert("groups", groupData as any);

    const creatorMemberId = await ctx.db.insert("groupMembers", {
      groupId,
      userId,
      name: args.memberName.trim(),
      joinedAt: now,
    });

    if (args.additionalMembers && args.additionalMembers.length > 0) {
      for (const name of args.additionalMembers) {
        if (name.trim()) {
          await ctx.db.insert("groupMembers", {
            groupId,
            userId: "anonymous",
            name: name.trim(),
            joinedAt: now,
          });
        }
      }
    }

    return { groupId, inviteCode, memberId: creatorMemberId };
  },
});

export const updateGroupSettings = mutation({
  args: {
    groupId: v.id("groups"),
    name: v.string(),
    currency: v.string(),
    allowedCurrencies: v.array(v.string()),
    fxRateToALL: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? "anonymous";

    const group = await ctx.db.get(args.groupId);
    if (!group || group.deleted) {
      throw new Error("Group not found.");
    }
    if (group.createdBy !== userId) {
      throw new Error("Only the group owner can change settings.");
    }

    const baseCurrency = assertValidCurrencyCode(args.currency);
    const allowed = Array.from(
      new Set([baseCurrency, ...args.allowedCurrencies.map(assertValidCurrencyCode)])
    );

    const normalized = normalizeName(args.name);
    if (!normalized) {
      throw new Error("Group name cannot be empty.");
    }
    const allGroups = await ctx.db.query("groups").collect();
    const ownedDuplicate = allGroups.find(
      (g) =>
        !g.deleted &&
        g.createdBy === userId &&
        g._id !== args.groupId &&
        normalizeName(g.name) === normalized
    );
    if (ownedDuplicate) {
      throw new Error(
        `You already own a group called "${ownedDuplicate.name}". Pick a different name.`
      );
    }

    const currencyChanged = baseCurrency !== group.currency;

    await ctx.db.patch(args.groupId, {
      name: args.name.trim(),
      currency: baseCurrency,
      allowedCurrencies: allowed as any,
    });

    if (currencyChanged) {
      const rateToALL =
        baseCurrency === "ALL"
          ? 1
          : args.fxRateToALL && args.fxRateToALL > 0
            ? args.fxRateToALL
            : FALLBACK_RATES_TO_ALL[baseCurrency] ?? 100;

      const expenses = await ctx.db
        .query("groupExpenses")
        .filter((q) =>
          q.and(
            q.eq(q.field("groupId"), args.groupId),
            q.neq(q.field("deleted"), true)
          )
        )
        .collect();

      for (const exp of expenses) {
        const nextAmountInGroup =
          exp.currency === baseCurrency
            ? exp.amount
            : baseCurrency === "ALL"
              ? exp.amountInALL
              : Math.round((exp.amountInALL / rateToALL) * 100) / 100;

        const weights: Record<string, number> = {};
        for (const s of exp.splits) {
          weights[s.memberId] = s.amountALL > 0 ? s.amountALL : 0;
        }
        const groupAlloc = allocateByShares(nextAmountInGroup, weights);

        const updatedSplits = exp.splits.map((s) => ({
          ...s,
          amountGroup: groupAlloc[s.memberId] ?? 0,
        }));

        const nextFxRateToGroup =
          exp.currency === baseCurrency
            ? 1
            : exp.amount > 0
              ? Math.round((nextAmountInGroup / exp.amount) * 1000000) / 1000000
              : 1;

        await ctx.db.patch(exp._id, {
          amountInGroupCurrency: nextAmountInGroup,
          fxRateToGroup: nextFxRateToGroup,
          splits: updatedSplits,
        });
      }

      const settlements = await ctx.db
        .query("groupSettlements")
        .filter((q) =>
          q.and(
            q.eq(q.field("groupId"), args.groupId),
            q.neq(q.field("deleted"), true)
          )
        )
        .collect();

      for (const set of settlements) {
        const nativeAmt = set.amount ?? set.amountALL;
        const nextAmountInGroup =
          set.currency === baseCurrency && typeof set.amount === "number"
            ? set.amount
            : baseCurrency === "ALL"
              ? set.amountALL
              : Math.round((set.amountALL / rateToALL) * 100) / 100;

        const nextFxRateToGroup =
          set.currency === baseCurrency
            ? 1
            : nativeAmt > 0
              ? Math.round((nextAmountInGroup / nativeAmt) * 1000000) / 1000000
              : 1;

        await ctx.db.patch(set._id, {
          amountInGroupCurrency: nextAmountInGroup,
          fxRateToGroup: nextFxRateToGroup,
        });
      }
    }
  },
});

export const archiveGroup = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.groupId, { status: "archived" });
  },
});

export const unarchiveGroup = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.groupId, { status: "active" });
  },
});

export const deleteGroup = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? "anonymous";

    const group = await ctx.db.get(args.groupId);
    if (!group || group.deleted) {
      throw new Error("Group not found.");
    }
    if (group.createdBy !== userId) {
      throw new Error("Only the group owner can delete a group. Archive it instead.");
    }

    const settlements = await ctx.db
      .query("groupSettlements")
      .filter((q) => q.eq(q.field("groupId"), args.groupId))
      .collect();
    for (const s of settlements) await ctx.db.delete(s._id);

    const expenses = await ctx.db
      .query("groupExpenses")
      .filter((q) => q.eq(q.field("groupId"), args.groupId))
      .collect();
    for (const e of expenses) await ctx.db.delete(e._id);

    const members = await ctx.db
      .query("groupMembers")
      .filter((q) => q.eq(q.field("groupId"), args.groupId))
      .collect();
    for (const m of members) await ctx.db.delete(m._id);

    await ctx.db.delete(args.groupId);

    return { deleted: true, groupId: args.groupId };
  },
});

export const joinGroup = mutation({
  args: {
    groupIdOrCode: v.string(),
    memberName: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? "anonymous";
    const now = Date.now();

    const queryStr = args.groupIdOrCode.trim().toUpperCase();
    const allGroups = await ctx.db.query("groups").collect();
    const group = allGroups.find(
      (g) =>
        !g.deleted &&
        (g._id === args.groupIdOrCode ||
          (g as any).inviteCode?.toUpperCase() === queryStr)
    );

    if (!group) {
      throw new Error("Group not found with that Invite Code or ID.");
    }

    const existingMembers = await ctx.db
      .query("groupMembers")
      .filter((q) =>
        q.and(
          q.eq(q.field("groupId"), group._id),
          q.eq(q.field("userId"), userId)
        )
      )
      .collect();

    if (existingMembers.length > 0) {
      return { groupId: group._id, memberId: existingMembers[0]._id };
    }

    const memberId = await ctx.db.insert("groupMembers", {
      groupId: group._id,
      userId,
      name: args.memberName.trim(),
      joinedAt: now,
    });

    return { groupId: group._id, memberId };
  },
});

export const claimMember = mutation({
  args: {
    memberId: v.id("groupMembers"),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? "anonymous";

    const member = await ctx.db.get(args.memberId);
    if (!member) {
      throw new Error("Member profile not found");
    }

    const patchData: { userId: string; name?: string } = { userId };
    if (args.name?.trim()) {
      patchData.name = args.name.trim();
    }

    await ctx.db.patch(args.memberId, patchData);
    return { groupId: member.groupId, memberId: args.memberId };
  },
});

export const addMember = mutation({
  args: {
    groupId: v.id("groups"),
    name: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const memberId = await ctx.db.insert("groupMembers", {
      groupId: args.groupId,
      name: args.name.trim(),
      userId: args.userId ?? "anonymous",
      joinedAt: now,
    });
    return memberId;
  },
});

export const addExpense = mutation({
  args: {
    groupId: v.id("groups"),
    title: v.string(),
    amount: v.number(),
    currency: v.string(),
    amountInGroupCurrency: v.optional(v.number()),
    amountInALL: v.number(),
    fxRateToGroup: v.optional(v.number()),
    fxRateToALL: v.optional(v.number()),
    category: v.optional(v.string()),
    paidByMemberId: v.id("groupMembers"),
    paidByUserId: v.optional(v.string()),
    splitType: v.union(v.literal("equal"), v.literal("exact"), v.literal("shares")),
    splits: v.array(
      v.object({
        memberId: v.id("groupMembers"),
        userId: v.optional(v.string()),
        amountGroup: v.optional(v.number()),
        amountALL: v.number(),
      })
    ),
    paidWith: v.optional(v.union(v.literal("Cash"), v.literal("Card"))),
    isBigExpense: v.optional(v.boolean()),
    syncToPulse: v.optional(v.boolean()),
    pulseSourceExpenseId: v.optional(v.string()),
    timestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group || group.deleted) {
      throw new Error("Group not found.");
    }

    const currency = assertValidCurrencyCode(args.currency);
    if (args.amount <= 0 || args.amountInALL <= 0) {
      throw new Error("Expense amount and ALL amount must be greater than 0.");
    }

    const amountInGroupCurrency = resolveGroupAmount(
      args.amount,
      currency,
      args.amountInALL,
      group.currency,
      args.amountInGroupCurrency
    );

    const normalizedSplits = ensureSplitsHaveGroupAmounts(
      args.splits,
      amountInGroupCurrency
    );

    assertSplitsBalance(normalizedSplits, args.amountInALL);
    assertGroupSplitsBalance(normalizedSplits, amountInGroupCurrency);

    const now = Date.now();
    const fxRateToGroup =
      args.fxRateToGroup ??
      (currency === group.currency
        ? 1
        : Math.round((amountInGroupCurrency / args.amount) * 1000000) / 1000000);
    const fxRateToALL =
      args.fxRateToALL ??
      (currency === "ALL" ? 1 : Math.round((args.amountInALL / args.amount) * 1000000) / 1000000);

    const expenseId = await ctx.db.insert("groupExpenses", {
      groupId: args.groupId,
      title: args.title,
      amount: args.amount,
      currency,
      amountInGroupCurrency,
      amountInALL: args.amountInALL,
      fxRateToGroup,
      fxRateToALL,
      category: args.category,
      paidByMemberId: args.paidByMemberId,
      paidByUserId: args.paidByUserId,
      splitType: args.splitType,
      splits: normalizedSplits,
      paidWith: args.paidWith ?? "Card",
      isBigExpense: args.isBigExpense ?? false,
      syncToPulse: args.syncToPulse ?? true,
      pulseSourceExpenseId: args.pulseSourceExpenseId,
      timestamp: args.timestamp ?? now,
      createdAt: now,
    });
    return expenseId;
  },
});

export const addGroupExpense = addExpense;

export const updateExpense = mutation({
  args: {
    expenseId: v.id("groupExpenses"),
    title: v.string(),
    amount: v.number(),
    currency: v.string(),
    amountInGroupCurrency: v.optional(v.number()),
    amountInALL: v.number(),
    fxRateToGroup: v.optional(v.number()),
    fxRateToALL: v.optional(v.number()),
    category: v.optional(v.string()),
    paidByMemberId: v.id("groupMembers"),
    splitType: v.union(v.literal("equal"), v.literal("exact"), v.literal("shares")),
    splits: v.array(
      v.object({
        memberId: v.id("groupMembers"),
        userId: v.optional(v.string()),
        amountGroup: v.optional(v.number()),
        amountALL: v.number(),
      })
    ),
    paidWith: v.optional(v.union(v.literal("Cash"), v.literal("Card"))),
    isBigExpense: v.optional(v.boolean()),
    syncToPulse: v.optional(v.boolean()),
    timestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.expenseId);
    if (!existing) {
      throw new Error("Expense not found.");
    }
    const group = await ctx.db.get(existing.groupId);
    const groupCurrency = group?.currency ?? "EUR";

    const currency = assertValidCurrencyCode(args.currency);
    if (args.amount <= 0 || args.amountInALL <= 0) {
      throw new Error("Expense amount and ALL amount must be greater than 0.");
    }

    const amountInGroupCurrency = resolveGroupAmount(
      args.amount,
      currency,
      args.amountInALL,
      groupCurrency,
      args.amountInGroupCurrency
    );

    const normalizedSplits = ensureSplitsHaveGroupAmounts(
      args.splits,
      amountInGroupCurrency
    );

    assertSplitsBalance(normalizedSplits, args.amountInALL);
    assertGroupSplitsBalance(normalizedSplits, amountInGroupCurrency);

    const { expenseId, ...updates } = args;
    const fxRateToGroup =
      args.fxRateToGroup ??
      (currency === groupCurrency
        ? 1
        : Math.round((amountInGroupCurrency / args.amount) * 1000000) / 1000000);
    const fxRateToALL =
      args.fxRateToALL ??
      (currency === "ALL" ? 1 : Math.round((args.amountInALL / args.amount) * 1000000) / 1000000);

    await ctx.db.patch(expenseId, {
      ...updates,
      currency,
      amountInGroupCurrency,
      fxRateToGroup,
      fxRateToALL,
      splits: normalizedSplits,
      paidWith: args.paidWith ?? existing.paidWith ?? "Card",
      isBigExpense: args.isBigExpense ?? existing.isBigExpense ?? false,
      syncToPulse: args.syncToPulse ?? existing.syncToPulse ?? true,
      timestamp: args.timestamp ?? existing.timestamp,
    });
  },
});

export const repairExpenseSplits = mutation({
  args: {},
  handler: async (ctx) => {
    const expenses = await ctx.db.query("groupExpenses").collect();
    const repaired: string[] = [];
    const skipped: string[] = [];
    for (const exp of expenses) {
      if (exp.deleted) continue;
      const sum = exp.splits.reduce((s: number, x: any) => s + (x.amountALL ?? 0), 0);
      const diff = Math.abs(sum - exp.amountInALL);
      if (diff <= 0.01) {
        skipped.push(exp._id);
        continue;
      }
      const fixed = rebalanceSplits(
        exp.splits.map((s: any) => ({
          memberId: s.memberId,
          userId: s.userId,
          amountGroup: s.amountGroup,
          amountALL: s.amountALL,
        })),
        exp.amountInALL
      );
      await ctx.db.patch(exp._id, { splits: fixed });
      repaired.push(exp._id);
    }
    return { repaired, skipped };
  },
});

export const repairUnconvertedCurrencyRecords = mutation({
  args: {
    customRatesToALL: v.optional(v.record(v.string(), v.number())),
  },
  handler: async (ctx, args) => {
    const rates: Record<string, number> = {
      ...FALLBACK_RATES_TO_ALL,
      ...(args.customRatesToALL ?? {}),
    };

    const repairedExpenses: string[] = [];
    const repairedSettlements: string[] = [];

    const expenses = await ctx.db.query("groupExpenses").collect();
    for (const exp of expenses) {
      if (exp.deleted) continue;
      const cur = exp.currency.toUpperCase();
      if (cur === "ALL") continue;
      const rate = rates[cur];
      if (!rate || rate === 1) continue;

      if (Math.abs(exp.amountInALL - exp.amount) < 0.001) {
        const nextAmountInALL = Math.round(exp.amount * rate * 100) / 100;
        const fixedSplits = rebalanceSplits(
          exp.splits.map((s: any) => ({
            memberId: s.memberId,
            userId: s.userId,
            amountGroup: s.amountGroup,
            amountALL: s.amountALL,
          })),
          nextAmountInALL
        );
        await ctx.db.patch(exp._id, {
          amountInALL: nextAmountInALL,
          fxRateToALL: rate,
          splits: fixedSplits,
        });
        repairedExpenses.push(exp._id);
      }
    }

    const settlements = await ctx.db.query("groupSettlements").collect();
    for (const set of settlements) {
      if (set.deleted) continue;
      const cur = set.currency.toUpperCase();
      if (cur === "ALL") continue;
      const rate = rates[cur];
      if (!rate || rate === 1) continue;

      if (set.amount === undefined) {
        const nextAmountALL = Math.round(set.amountALL * rate * 100) / 100;
        await ctx.db.patch(set._id, {
          amount: set.amountALL,
          amountALL: nextAmountALL,
          fxRateToALL: rate,
        });
        repairedSettlements.push(set._id);
      }
    }

    return { repairedExpenses, repairedSettlements };
  },
});

export const deleteExpense = mutation({
  args: {
    expenseId: v.id("groupExpenses"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.expenseId, {
      deleted: true,
    });
  },
});

export const settleGroupDebt = mutation({
  args: {
    groupId: v.id("groups"),
    fromMemberId: v.id("groupMembers"),
    toMemberId: v.id("groupMembers"),
    fromUserId: v.optional(v.string()),
    toUserId: v.optional(v.string()),
    amount: v.optional(v.number()),
    amountInGroupCurrency: v.optional(v.number()),
    amountALL: v.number(),
    fxRateToGroup: v.optional(v.number()),
    fxRateToALL: v.optional(v.number()),
    currency: v.string(),
    paidWith: v.optional(v.union(v.literal("Cash"), v.literal("Card"))),
    timestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group || group.deleted) {
      throw new Error("Group not found.");
    }

    const currency = assertValidCurrencyCode(args.currency);
    if (args.amountALL <= 0) {
      throw new Error("Settlement amount in ALL must be greater than 0.");
    }
    const now = Date.now();
    const nativeAmount = args.amount ?? args.amountInGroupCurrency ?? args.amountALL;
    const amountInGroupCurrency = resolveGroupAmount(
      nativeAmount,
      currency,
      args.amountALL,
      group.currency,
      args.amountInGroupCurrency
    );
    const fxRateToGroup =
      args.fxRateToGroup ??
      (currency === group.currency
        ? 1
        : Math.round((amountInGroupCurrency / nativeAmount) * 1000000) / 1000000);
    const fxRateToALL =
      args.fxRateToALL ??
      (currency === "ALL" ? 1 : Math.round((args.amountALL / nativeAmount) * 1000000) / 1000000);

    const settlementId = await ctx.db.insert("groupSettlements", {
      groupId: args.groupId,
      fromMemberId: args.fromMemberId,
      toMemberId: args.toMemberId,
      fromUserId: args.fromUserId,
      toUserId: args.toUserId,
      amount: nativeAmount,
      amountInGroupCurrency,
      amountALL: args.amountALL,
      fxRateToGroup,
      fxRateToALL,
      currency,
      paidWith: args.paidWith ?? "Cash",
      timestamp: args.timestamp ?? now,
      createdAt: now,
    });
    return settlementId;
  },
});

export const addSettlement = settleGroupDebt;