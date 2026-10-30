import { describe, expect, it } from "vitest";
import { cleanModelJson } from "./nebius";
import { reconcileReceipt, receiptJsonSchema, receiptSchema, type ExtractedReceipt } from "./receipt";

const receipt = (over: Partial<ExtractedReceipt> = {}): ExtractedReceipt => ({
  kind: "receipt",
  merchant: "Diner",
  category: "food",
  date: "2026-10-01",
  currency: "USD",
  items: [
    { name: "Burger", quantity: 1, totalPrice: 12.5 },
    { name: "Fries", quantity: 2, totalPrice: 7 },
  ],
  subtotal: 19.5,
  tax: 1.56,
  tip: null,
  suggestedTips: [3.51, 3.9],
  serviceCharge: null,
  discount: null,
  total: 21.06,
  paidByHint: null,
  ...over,
});

describe("reconcileReceipt", () => {
  it("passes a consistent receipt", () => {
    expect(reconcileReceipt(receipt())).toEqual([]);
  });

  it("flags subtotal and total mismatches", () => {
    const issues = reconcileReceipt(receipt({ subtotal: 25, total: 30 }));
    expect(issues.map((i) => i.field)).toEqual(["subtotal", "total"]);
  });

  it("does not treat suggested tips as charged", () => {
    expect(reconcileReceipt(receipt({ suggestedTips: [100] }))).toEqual([]);
  });

  it("flags a missing currency", () => {
    expect(reconcileReceipt(receipt({ currency: null })).map((i) => i.field)).toEqual(["currency"]);
  });
});

describe("cleanModelJson", () => {
  it("strips think blocks and fences", () => {
    expect(cleanModelJson('<think>hmm</think>\n```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(cleanModelJson('Sure! {"a":{"b":2}} done')).toBe('{"a":{"b":2}}');
    // Reasoning written before the answer, with stray braces in it.
    expect(cleanModelJson('Use {line} numbers from the bill.\n\n{"lines":[1],"ok":true}')).toBe('{"lines":[1],"ok":true}');
  });
});

it("emits a provider-friendly JSON schema", () => {
  expect(receiptJsonSchema).not.toHaveProperty("$schema");
  expect(receiptJsonSchema).toMatchObject({ type: "object" });
});

it("accepts non-restaurant receipts and rejects unknown categories", () => {
  expect(receiptSchema.parse(receipt({ merchant: "Hotel Lux", category: "accommodation", tip: null })).category).toBe("accommodation");
  expect(() => receiptSchema.parse({ ...receipt(), category: "spaceships" })).toThrow();
});
