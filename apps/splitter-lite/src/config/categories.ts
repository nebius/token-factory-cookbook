import {
  BedDouble,
  Car,
  Gift,
  Home,
  type LucideIcon,
  Mountain,
  PartyPopper,
  Plane,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Ticket,
  UtensilsCrossed,
} from "lucide-react";

// Shared by the UI, the server-side validation and the receipt-reading prompt.
export const CATEGORY_KEYS = [
  "food",
  "groceries",
  "accommodation",
  "transport",
  "flights",
  "tickets",
  "activities",
  "party",
  "shopping",
  "home",
  "gifts",
  "other",
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORIES: Record<CategoryKey, { label: string; icon: LucideIcon }> = {
  food: { label: "Food & drink", icon: UtensilsCrossed },
  groceries: { label: "Groceries", icon: ShoppingCart },
  accommodation: { label: "Stay", icon: BedDouble },
  transport: { label: "Transport", icon: Car },
  flights: { label: "Flights", icon: Plane },
  tickets: { label: "Tickets", icon: Ticket },
  activities: { label: "Activities", icon: Mountain },
  party: { label: "Party", icon: PartyPopper },
  shopping: { label: "Shopping", icon: ShoppingBag },
  home: { label: "Home & bills", icon: Home },
  gifts: { label: "Gifts", icon: Gift },
  other: { label: "Other", icon: Sparkles },
};

export const isCategory = (value: unknown): value is CategoryKey =>
  typeof value === "string" && (CATEGORY_KEYS as readonly string[]).includes(value);

export const categoryOf = (value: string | null | undefined) => CATEGORIES[isCategory(value) ? value : "other"];

export const GROUP_KIND_KEYS = ["trip", "party", "event", "home", "dinner", "other"] as const;
export type GroupKind = (typeof GROUP_KIND_KEYS)[number];

/** Presets for new groups, plus the copy "Settle with AI" uses for each kind of group. */
export const GROUP_KINDS: Record<
  GroupKind,
  { label: string; emoji: string; defaultCategory: CategoryKey; example: string; noteExamples: string[] }
> = {
  trip: {
    label: "Trip",
    emoji: "✈️",
    defaultCategory: "accommodation",
    example: "Lisbon weekend",
    noteExamples: [
      "Lukas paid #1 and #2. Marco paid 200 twice for taxis. Elena paid 500 for drinks.",
      "Hotel split by room: couples count as 2.",
      "Dinner on day 2 was only Lukas, Marco and me.",
    ],
  },
  party: {
    label: "Party",
    emoji: "🎉",
    defaultCategory: "party",
    example: "Maya's 30th",
    noteExamples: [
      "I bought decorations, Leo paid the venue deposit.",
      "Cake is split only among the 4 hosts.",
      "Sophie doesn't drink, leave her out of the drinks bill.",
    ],
  },
  event: {
    label: "Event",
    emoji: "🎟️",
    defaultCategory: "tickets",
    example: "Festival weekend",
    noteExamples: [
      "Tickets: Lukas's was 2,500, everyone else 1,800.",
      "Marco booked the cab both ways.",
      "Food stalls split equally.",
    ],
  },
  home: {
    label: "Home",
    emoji: "🏠",
    defaultCategory: "home",
    example: "Flat 4B",
    noteExamples: ["Rent split by room size 2:1:1.", "Internet and electricity equally.", "I paid the grocery run on the 3rd."],
  },
  dinner: {
    label: "Dinners",
    emoji: "🍽️",
    defaultCategory: "food",
    example: "Friday dinner club",
    noteExamples: ["Elena paid the restaurant, I paid the bar tab.", "Marco only had the starters.", "Split the wine among the 3 who drank."],
  },
  other: {
    label: "Other",
    emoji: "👥",
    defaultCategory: "other",
    example: "Office gifts",
    noteExamples: ["Lukas paid #1. Split everything equally.", "Marco already sent me 300."],
  },
};

export const isGroupKind = (value: unknown): value is GroupKind =>
  typeof value === "string" && (GROUP_KIND_KEYS as readonly string[]).includes(value);
