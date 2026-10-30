import { describe, expect, it } from "vitest";
import {
  allocate,
  computeBalances,
  computeSplit,
  currencyExponent,
  formatMoney,
  parseMoneyInput,
  sanitizeMoneyText,
  simplifyDebts,
  SplitError,
  toMinor,
} from ".";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("allocate", () => {
  it("always conserves the total", () => {
    for (let total = 0; total < 500; total += 7) {
      for (const weights of [[1, 1, 1], [1, 2], [3, 0, 1], [0.5, 0.25, 0.25], [7]]) {
        expect(sum(allocate(total, weights))).toBe(total);
      }
    }
  });

  it("splits 100 three ways deterministically", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("never gives cents to zero-weight entries", () => {
    expect(allocate(5, [0, 1, 1])).toEqual([0, 3, 2]);
  });

  it("splits equally when all weights are zero", () => {
    expect(allocate(10, [0, 0])).toEqual([5, 5]);
  });

  it("handles negative totals", () => {
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });
});

describe("computeSplit", () => {
  const members = ["a", "b", "c"];

  it("rejects unassigned items", () => {
    try {
      computeSplit({
        memberIds: members,
        items: [
          { id: "i1", amount: 1000, assignees: [{ memberId: "a", weight: 1 }] },
          { id: "i2", amount: 500, assignees: [] },
        ],
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SplitError);
      expect((e as SplitError).code).toBe("UNASSIGNED_ITEMS");
      expect((e as SplitError).itemIds).toEqual(["i2"]);
    }
  });

  it("rejects an empty member list", () => {
    expect(() => computeSplit({ memberIds: [], items: [] })).toThrow(SplitError);
  });

  it("rejects assignees outside the split", () => {
    expect(() =>
      computeSplit({
        memberIds: ["a"],
        items: [{ id: "i1", amount: 100, assignees: [{ memberId: "zz", weight: 1 }] }],
      }),
    ).toThrow(/outside/);
  });

  it("rejects negative amounts", () => {
    expect(() =>
      computeSplit({
        memberIds: ["a"],
        items: [{ id: "i1", amount: -1, assignees: [{ memberId: "a", weight: 1 }] }],
      }),
    ).toThrow(SplitError);
  });

  it("spreads tax and tip proportionally and balances to the cent", () => {
    const result = computeSplit({
      memberIds: members,
      items: [
        { id: "steak", amount: 3000, assignees: [{ memberId: "a", weight: 1 }] },
        { id: "salad", amount: 1000, assignees: [{ memberId: "b", weight: 1 }] },
        {
          id: "wine",
          amount: 2001,
          assignees: members.map((memberId) => ({ memberId, weight: 1 })),
        },
      ],
      tax: 533,
      tip: 1000,
      serviceCharge: 0,
      discount: 250,
    });
    expect(result.subtotal).toBe(6001);
    expect(result.total).toBe(6001 + 533 + 1000 - 250);
    expect(sum(result.shares.map((s) => s.total))).toBe(result.total);
    expect(sum(result.shares.map((s) => s.tax))).toBe(533);
    // a ate the most, so pays the most tax
    const [a, b, c] = result.shares;
    expect(a.tax).toBeGreaterThan(b.tax);
    expect(b.tax).toBeGreaterThan(c.tax);
  });

  it("supports weighted item shares", () => {
    const result = computeSplit({
      memberIds: ["a", "b"],
      items: [
        {
          id: "pizza",
          amount: 1200,
          assignees: [
            { memberId: "a", weight: 2 },
            { memberId: "b", weight: 1 },
          ],
        },
      ],
    });
    expect(result.shares.map((s) => s.items)).toEqual([800, 400]);
  });

  it("is conservative under many random splits", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 200; run++) {
      const memberIds = ["a", "b", "c", "d", "e"].slice(0, 1 + Math.floor(rand() * 5));
      const items = Array.from({ length: 1 + Math.floor(rand() * 8) }, (_, i) => ({
        id: `i${i}`,
        amount: Math.floor(rand() * 10000),
        assignees: memberIds
          .filter(() => rand() > 0.4)
          .map((memberId) => ({ memberId, weight: 1 + Math.floor(rand() * 3) })),
      })).map((item) =>
        item.assignees.length ? item : { ...item, assignees: [{ memberId: memberIds[0], weight: 1 }] },
      );
      const result = computeSplit({
        memberIds,
        items,
        tax: Math.floor(rand() * 999),
        tip: Math.floor(rand() * 999),
        serviceCharge: Math.floor(rand() * 99),
      });
      expect(sum(result.shares.map((s) => s.total))).toBe(result.total);
    }
  });
});

describe("currency helpers", () => {
  it("knows zero-decimal and three-decimal currencies", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });

  it("converts without float drift", () => {
    expect(toMinor(1.005, "USD")).toBe(101);
    expect(toMinor(0.29, "USD")).toBe(29);
    expect(toMinor(1500, "JPY")).toBe(1500);
  });

  it("parses user input", () => {
    expect(parseMoneyInput("$1,204.10", "USD")).toBe(120410);
    expect(parseMoneyInput("12,5", "EUR")).toBe(1250);
    expect(parseMoneyInput("abc", "USD")).toBeNull();
  });

  it("keeps money fields numeric while typing", () => {
    expect(sanitizeMoneyText("12abc.5x6", "USD")).toBe("12.56");
    expect(sanitizeMoneyText("₹1,204.505", "INR")).toBe("1204.50");
    expect(sanitizeMoneyText("hello", "USD")).toBe("");
    expect(sanitizeMoneyText("1500.75", "JPY")).toBe("1500");
    expect(sanitizeMoneyText("007", "USD")).toBe("7");
    expect(sanitizeMoneyText(".5", "EUR")).toBe("0.5");
    expect(sanitizeMoneyText("12345678901", "USD")).toBe("123456789");
    expect(sanitizeMoneyText("12.", "USD")).toBe("12.");
  });

  it("reads grouped amounts the way people write them", () => {
    expect(parseMoneyInput("₹1,20,400.50", "INR")).toBe(12040050);
    expect(parseMoneyInput("1.234,56", "EUR")).toBe(123456);
    expect(parseMoneyInput("1,204.50", "USD")).toBe(120450);
    expect(parseMoneyInput("12,50", "EUR")).toBe(1250);
    expect(parseMoneyInput("1.234", "EUR")).toBe(123); // single dot is a decimal point; extra decimals trimmed
    expect(parseMoneyInput("1,500", "JPY")).toBe(1500);
    expect(parseMoneyInput("1.250,500", "KWD")).toBe(1250500);
    expect(sanitizeMoneyText("₹1,20,400.50", "INR")).toBe("120400.50");
  });

  it("accepts only real ISO currencies", async () => {
    const { isValidCurrency } = await import(".");
    expect(isValidCurrency("INR")).toBe(true);
    expect(isValidCurrency("ZZZ")).toBe(false);
    expect(isValidCurrency("usd")).toBe(false);
  });

  it("formats", () => {
    expect(formatMoney(120410, "USD", "en-US")).toBe("$1,204.10");
    expect(formatMoney(1500, "JPY", "en-US")).toBe("¥1,500");
  });
});

describe("balances", () => {
  it("nets expenses and settlements to zero", () => {
    const net = computeBalances(
      ["a", "b", "c"],
      [
        {
          paidByMemberId: "a",
          shares: [
            { memberId: "a", amount: 1000 },
            { memberId: "b", amount: 1000 },
            { memberId: "c", amount: 1000 },
          ],
        },
        { paidByMemberId: "b", shares: [{ memberId: "c", amount: 600 }] },
      ],
      [{ fromMemberId: "c", toMemberId: "a", amount: 500 }],
    );
    expect(net.get("a")).toBe(1500);
    expect(net.get("b")).toBe(-400);
    expect(net.get("c")).toBe(-1100);
    expect(sum([...net.values()])).toBe(0);
  });

  it("simplifies debts into minimal transfers", () => {
    const net = new Map([
      ["a", 1500],
      ["b", -400],
      ["c", -1100],
    ]);
    const transfers = simplifyDebts(net);
    expect(transfers).toEqual([
      { fromMemberId: "c", toMemberId: "a", amount: 1100 },
      { fromMemberId: "b", toMemberId: "a", amount: 400 },
    ]);
  });

  it("returns nothing when everyone is square", () => {
    expect(simplifyDebts(new Map([["a", 0]]))).toEqual([]);
  });
});

describe("moneyParts", () => {
  it("splits symbol and number for notification templates", async () => {
    const { moneyParts } = await import(".");
    expect(moneyParts(301000, "INR")).toEqual({ symbol: "₹", number: "3,010.00" });
    expect(moneyParts(1500, "JPY")).toEqual({ symbol: "¥", number: "1,500" });
    expect(moneyParts(1234, "USD")).toEqual({ symbol: "$", number: "12.34" });
  });
});
