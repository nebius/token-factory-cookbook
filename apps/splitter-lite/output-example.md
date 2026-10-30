# Output example

Real runs of `npm run check-samples` and `npm run agent` against `nvidia/Nemotron-3.5-Super-VL` on Nebius Token Factory (us-north1), 17 Oct 2026. No reasoning or sampling fields are sent, so Token Factory's defaults apply, which have reasoning on. Costs are computed from the price in Token Factory's `/v1/models?verbose=true` at run time. The bills are the synthetic samples in `samples/`, and `samples/answers.json` has their answer keys.

## Sample bills against their answer keys

```console
$ npm run check-samples
Model nvidia/Nemotron-3.5-Super-VL · reasoning on (Token Factory default) · $0.3/$0.9 per 1M tokens

✓ groceries-21         read ✓ · tool calls 3 · app check ✓
    model:  Lukas 14.82, Sophie 23.30
    answer: Lukas 14.82, Sophie 23.30
✓ dinner-01            read ✓ · tool calls 3 · app check ✓
    model:  Lukas 27.94, Sophie 27.90, Marco 44.72
    answer: Lukas 27.94, Sophie 27.90, Marco 44.72
✓ taxi-01              read ✓ · tool calls 3 · app check ✓
    model:  Lukas 12.03, Sophie 12.03
    answer: Lukas 12.03, Sophie 12.03
✓ dinner-01 + taxi-01  read ✓ · tool calls 5 · app check ✓
    model:  Lukas 39.97, Sophie 39.93, Marco 44.72
    answer: Lukas 39.97, Sophie 39.93, Marco 44.72

4/4 splits match the answer keys to the cent · total cost $0.0174
```

## One bill, who had what in plain English

Answer key for `groceries-21`: Lukas €14.82, Sophie €23.30.

```console
$ npm run agent -- samples/groceries-21.png "Sophie had the Coffee beans 500g, Lukas had the Dish soap, everything else shared" Lukas,Sophie
Model     nvidia/Nemotron-3.5-Super-VL
Endpoint  https://api.tokenfactory.us-north1.nebius.com/v1/
Reasoning on (Token Factory default; no reasoning or sampling fields are sent)
Price     $0.30 / 1M input · $0.90 / 1M output  (https://api.tokenfactory.us-north1.nebius.com/v1/models?verbose=true, 2026-10-16)

1 · READ
  samples/groceries-21.png: GREENLEAF SUPERMARKET · 6 lines · printed total 38.12 EUR
      Coffee beans 500g ×2 = 13.7
      Paper towels x6 ×1 = 5.32
      Dish soap ×3 = 5.97
      Whole milk 1L ×3 = 3.57
      Bananas 1kg ×2 = 3.26
      Greek yogurt ×1 = 2.83

2 · SPLIT (4.5s, 4 model turns)
  ✓ MODEL check_receipt({"bill":1})
          → {"bill":1,"ok":true,"issues":[],"linesTotal":34.65,"printedTotal":38.12}
  ✓ MODEL allocate_tax_tip({"bill":1,"lines":[{"line":1,"members":["Sophie"]},{"line":2,"members":["Lukas","Sophie"]},{"line":3,"members":["Lukas"]},{"line":4,"members":["Lukas","Sophie"]},{"line":5,"members":["Lukas","Sophie"]},{"line":6,"members":["Lukas","Sophie"]}]})
          → {"bill":1,"total":38.12,"shares":{"Lukas":14.82,"Sophie":23.3}}
  ✓ MODEL validate_total({"total":38.12,"shares":[{"member":"Lukas","amount":14.82},{"member":"Sophie","amount":23.3}]})
          → {"ok":true,"total":38.12,"sharesSum":38.12,"diff":0}
  ✓ APP   validate_total({"total":38.12,"shares":[{"member":"Lukas","amount":14.82},{"member":"Sophie","amount":23.3}]})
          → {"ok":true,"total":38.12,"sharesSum":38.12,"diff":0}

The model's split (EUR):
  Lukas      14.82
  Sophie     23.30
Validation ✓ Shares add up to 38.12, what the bill's lines and charges come to.
Why: Bill 1 checked OK. Line 1 assigned to Sophie (Sophie), line 3 to Lukas (Lukas), all other lines shared. allocate_tax_tip split tax proportionally: Lukas €14.82, Sophie €23.30, total €38.12, validated exactly.

AI usage
  read groceries-21.png                1831 in   1128 out (901 reasoning)    3.7s  $0.00156
  split with tools                     6808 in   1130 out (699 reasoning)    4.5s  $0.00306
  total                                8639 in   2258 out (1600 reasoning)    8.2s  $0.00462
```

## Two bills from one night out

Dinner at Trattoria da Luca, then a taxi that Marco skipped. Answer key: Lukas €39.97, Sophie €39.93, Marco €44.72.

```console
$ npm run agent -- samples/dinner-01.png samples/taxi-01.png "Marco had the Grilled sea bass and skipped the taxi; Lukas and Sophie shared the House red; everything else is shared by everyone" Lukas,Sophie,Marco
Model     nvidia/Nemotron-3.5-Super-VL
Endpoint  https://api.tokenfactory.us-north1.nebius.com/v1/
Reasoning on (Token Factory default; no reasoning or sampling fields are sent)
Price     $0.30 / 1M input · $0.90 / 1M output  (https://api.tokenfactory.us-north1.nebius.com/v1/models?verbose=true, 2026-10-16)

1 · READ
  samples/dinner-01.png: TRATTORIA DA LUCA · 5 lines · printed total 100.56 EUR
      Margherita pizza ×2 = 23.8
      Spaghetti carbonara ×1 = 14.5
      Grilled sea bass ×1 = 22
      Tiramisu ×1 = 7.5
      House red 0.5L ×1 = 16
  samples/taxi-01.png: Taxi Lisboa · 4 lines · printed total 24.06 EUR
      Base fare ×1 = 3.9
      Distance 14 km ×1 = 12.6
      Night surcharge ×1 = 3
      Luggage ×2 = 3.2
  Split together: 9 lines across 2 bills, total 124.62 EUR

2 · SPLIT (6.0s, 4 model turns)
  ✓ MODEL check_receipt({"bill":1})
          → {"bill":1,"ok":true,"issues":[],"linesTotal":83.8,"printedTotal":100.56}
  ✓ MODEL check_receipt({"bill":2})
          → {"bill":2,"ok":true,"issues":[],"linesTotal":22.7,"printedTotal":24.06}
  ✓ MODEL allocate_tax_tip({"bill":1,"lines":[{"line":1,"members":["Lukas","Sophie","Marco"]},{"line":2,"members":["Lukas","Sophie","Marco"]},{"line":3,"members":["Marco"]},{"line":4,"members":["Lukas","Sophie","Marco"]},{"line":5,"members":["Lukas","Sophie"]}]})
          → {"bill":1,"total":100.56,"shares":{"Lukas":27.94,"Sophie":27.9,"Marco":44.72}}
  ✓ MODEL allocate_tax_tip({"bill":2,"lines":[{"line":1,"members":["Lukas","Sophie"]},{"line":2,"members":["Lukas","Sophie"]},{"line":3,"members":["Lukas","Sophie"]},{"line":4,"members":["Lukas","Sophie"]}]})
          → {"bill":2,"total":24.06,"shares":{"Lukas":12.03,"Sophie":12.03}}
  ✓ MODEL validate_total({"total":124.62,"shares":[{"member":"Lukas","amount":39.97},{"member":"Sophie","amount":39.93},{"member":"Marco","amount":44.72}]})
          → {"ok":true,"total":124.62,"sharesSum":124.62,"diff":0}
  ✓ APP   validate_total({"total":124.62,"shares":[{"member":"Lukas","amount":39.97},{"member":"Sophie","amount":39.93},{"member":"Marco","amount":44.72}]})
          → {"ok":true,"total":124.62,"sharesSum":124.62,"diff":0}

The model's split (EUR):
  Lukas      39.97
  Sophie     39.93
  Marco      44.72
Validation ✓ Shares add up to 124.62, what the bills' lines and charges come to.
Why: Both receipts checked OK. Bill 1: lines 1, 2, 4 shared by everyone (Lukas, Sophie, Marco); line 3 sea bass only Marco (Marco); line 5 house red Lukas and Sophie (Lukas, Sophie). Bill 2 taxi: Marco skipped it, so all four lines shared by Lukas and Sophie (Lukas, Sophie). allocate_tax_tip gave Bill 1 shares Lukas=27.94, Sophie=27.90, Marco=44.72 and Bill 2 shares Lukas=12.03, Sophie=12.03. Combined totals: Lukas=39.97, Sophie=39.93, Marco=44.72, summing to 124.62, confirmed by validate_total.

AI usage
  read dinner-01.png                   1831 in   1166 out (960 reasoning)    4.0s  $0.00160
  read taxi-01.png                     1763 in    827 out (659 reasoning)    3.8s  $0.00127
  split with tools                     7687 in   2142 out (1377 reasoning)    6.0s  $0.00423
  total                               11281 in   4135 out (2996 reasoning)   13.7s  $0.00711
```
