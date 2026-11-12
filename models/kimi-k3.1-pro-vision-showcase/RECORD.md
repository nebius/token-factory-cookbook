# Kimi K3.1 Pro: ten vision tasks, what it did and what it missed

Model `moonshotai/Kimi-K3.1-Pro`, served by Nebius Token Factory (OpenAI-compatible endpoint `https://api.tokenfactory.nebius.com/v1`). Run on 2026-11-05.

## How this was run

- **Ten tasks taken from the vision-language literature**, each tied to a published benchmark (below).
- **Six samples per task, 60 in all**, drawn at random (seed 31) from each benchmark's public evaluation split via the Hugging Face datasets server. Nothing was hand-picked. Two constraints: COCO detection images were limited to those with 2-8 boxes so the overlays stay readable, and POPE was balanced to 3 'yes' / 3 'no'.
- One request per sample, the image as base64, default sampling, a single attempt. Prompts ask for a JSON answer (boxes and points in the image's own pixel frame); they are saved in `results/raw/`.
- Scored automatically against the benchmark labels with each benchmark's usual rule (`scripts/score.py`). Every sample that was not a clean hit was then checked by eye (`data/audit.json`).
- **This is a demonstration, not a benchmark score.** Six samples per task is far too few to estimate accuracy; the point is to show, on real benchmark items, what the model can do and where it slips.

## Scorecard: 48 / 60 hits

48 hits, 2 partial, 10 misses. Of the 12 non-hits, 3 look like benchmark label problems on inspection (marked *disputed*); the official count does not change for them.

| # | Task | Benchmark | Hit | Partial | Miss | Disputed | Mean metric |
|---|---|---|---|---|---|---|---|
| 1 | Object detection | COCO (Lin et al., 2014) | 5 | 1 | 0 | 0 | 0.82 (F1 @ IoU 0.5 (class-matched)) |
| 2 | Referring-expression grounding | RefCOCO (Kazemzadeh et al., 2014; Yu et al., 2016) | 5 | 0 | 1 | 0 | 0.80 (IoU >= 0.5) |
| 3 | Object counting | CountBench (Paiss et al., 2023) | 5 | 0 | 1 | 1 | 0.83 (exact count) |
| 4 | Scene-text VQA | TextVQA (Singh et al., 2019) | 5 | 1 | 0 | 0 | 0.94 (VQA accuracy) |
| 5 | Document VQA | DocVQA (Mathew et al., 2021) | 5 | 0 | 1 | 0 | 0.83 (ANLS) |
| 6 | Chart QA | ChartQA (Masry et al., 2022) | 6 | 0 | 0 | 0 | 1.00 (relaxed accuracy (5%)) |
| 7 | Visual math reasoning | MathVista (Lu et al., 2024) | 5 | 0 | 1 | 0 | 0.83 (exact answer) |
| 8 | Spatial-relation reasoning | VSR (Liu et al., 2023) | 4 | 0 | 2 | 0 | 0.67 (true/false accuracy) |
| 9 | Object hallucination probe | POPE adversarial (Li et al., 2023) | 3 | 0 | 3 | 1 | 0.50 (yes/no accuracy) |
| 10 | GUI element grounding | ScreenSpot (Cheng et al., 2024) | 5 | 0 | 1 | 1 | 0.83 (click inside target) |

Latency per request: median 12.4 s, range 3.6-375.4 s. Completion tokens (mostly reasoning): median 512, total 66,514. Detection prompts take about 45-90 s because the model reasons through every box. The four slowest requests were all misses or partials: the ticket count (375 s, 11.6k tokens), the bench grounding (131 s), a detection partial (112 s) and a VSR miss (109 s). Long reasoning is a fair signal that the model is unsure.

## The ten tasks

### 1. Object detection: 5/6

**What it tests.** Find and box every object from the 80 COCO categories.

**Source.** Lin et al., *Microsoft COCO: Common Objects in Context*, ECCV 2014.

**Scoring.** Kimi gets the 80 category names and returns one labelled box per instance. A box counts if it has the right class and IoU >= 0.5 with an unused ground-truth box. Hit = F1 >= 0.8, partial = F1 >= 0.4.

| Sample | Question | Kimi said | Truth | Verdict | Note |
|---|---|---|---|---|---|
| [coco_776](results/viz/detection__coco_776.jpg) | Detect all COCO objects | 3 boxes | 4 boxes | hit | missed bed |
| [coco_8899](results/viz/detection__coco_8899.jpg) | Detect all COCO objects | 2 boxes | 2 boxes | hit | all objects found |
| [coco_1425](results/viz/detection__coco_1425.jpg) | Detect all COCO objects | 3 boxes | 2 boxes | partial | Boxes were well placed, but it called the small ramekin a 'cup' (COCO says 'bowl') and added a 'dining table' box over the plate. |
| [coco_7386](results/viz/detection__coco_7386.jpg) | Detect all COCO objects | 4 boxes | 5 boxes | hit | missed bicycle |
| [coco_3501](results/viz/detection__coco_3501.jpg) | Detect all COCO objects | 4 boxes | 3 boxes | hit | extra/unmatched dining table |
| [coco_1503](results/viz/detection__coco_1503.jpg) | Detect all COCO objects | 4 boxes | 5 boxes | hit | missed mouse |

### 2. Referring-expression grounding: 5/6

**What it tests.** Box the single object a short human phrase refers to ('left dude', 'girl in blue coat').

**Source.** Kazemzadeh et al., *ReferItGame*, EMNLP 2014; Yu et al., *Modeling Context in Referring Expressions*, ECCV 2016.

**Scoring.** Hit = IoU >= 0.5 with the annotated box (the standard RefCOCO accuracy rule).

| Sample | Question | Kimi said | Truth | Verdict | Note |
|---|---|---|---|---|---|
| [refcoco_457142](results/viz/grounding__refcoco_457142.jpg) | girl in blue coat | IoU 0.98 | annotated box | hit | IoU 0.98 with the annotated box |
| [refcoco_2125874](results/viz/grounding__refcoco_2125874.jpg) | unoccupied bench bottom center | IoU 0.45 | annotated box | miss | Boxed the whole bench, including the half the woman sits on; the expression asks for the empty part only (IoU 0.45, just under the 0.5 bar). |
| [refcoco_1219163](results/viz/grounding__refcoco_1219163.jpg) | guy on left with beard and guitar | IoU 0.99 | annotated box | hit | IoU 0.99 with the annotated box |
| [refcoco_500538](results/viz/grounding__refcoco_500538.jpg) | sitting guy | IoU 0.91 | annotated box | hit | IoU 0.91 with the annotated box |
| [refcoco_427086](results/viz/grounding__refcoco_427086.jpg) | left dude | IoU 0.95 | annotated box | hit | IoU 0.95 with the annotated box |
| [refcoco_1610050](results/viz/grounding__refcoco_1610050.jpg) | flowers below the umbrella | IoU 0.53 | annotated box | hit | IoU 0.53 with the annotated box |

### 3. Object counting: 5/6

**What it tests.** Count the objects in an image, here with a point on each one.

**Source.** Paiss et al., *Teaching CLIP to Count to Ten*, ICCV 2023 (CountBench).

**Scoring.** Hit = exact count. Kimi also returns a point per instance, which is drawn on the overlay.

| Sample | Question | Kimi said | Truth | Verdict | Note |
|---|---|---|---|---|---|
| [countbench_16](results/viz/counting__countbench_16.jpg) | How many outfits are there in the image? | 4 | 4 | hit | exact |
| [countbench_31](results/viz/counting__countbench_31.jpg) | How many pumpkin candles are there in the image? | 3 | 3 | hit | exact |
| [countbench_69](results/viz/counting__countbench_69.jpg) | How many chairs are there in the image? | 6 | 6 | hit | exact |
| [countbench_75](results/viz/counting__countbench_75.jpg) | How many photos of fruit are there in the image? | 9 | 9 | hit | exact |
| [countbench_339](results/viz/counting__countbench_339.jpg) | How many butterflies are there in the image? | 10 | 10 | hit | exact |
| [countbench_379](results/viz/counting__countbench_379.jpg) | How many tickets are there in the image? | 5 | 3 | miss (disputed) | Kimi pointed at 5 separate slips. CountBench's label comes from the image caption ('three tickets'); at least 4-5 distinct slips are visible. |

### 4. Scene-text VQA: 5/6

**What it tests.** Answer a question that requires reading text in a natural photo.

**Source.** Singh et al., *Towards VQA Models That Can Read*, CVPR 2019 (TextVQA).

**Scoring.** Standard VQA accuracy: min(#annotators who gave the answer / 3, 1). Hit = 1.0, partial = above 0.

| Sample | Question | Kimi said | Truth | Verdict | Note |
|---|---|---|---|---|---|
| [textvqa_36280](results/viz/textvqa__textvqa_36280.jpg) | what does the text on top of the telephone box say? | Phone | phone | hit | 10/10 annotators gave this answer |
| [textvqa_36495](results/viz/textvqa__textvqa_36495.jpg) | what is the title of the book? | het Judasoog | het judasoog | hit | 10/10 annotators gave this answer |
| [textvqa_37981](results/viz/textvqa__textvqa_37981.jpg) | what brand of watch is this? | ROLEX | rolex | hit | 10/10 annotators gave this answer |
| [textvqa_38269](results/viz/textvqa__textvqa_38269.jpg) | what does the orange letters on top of the bus say? | VOLVO 7900 HYBRID | volvo 7900 hybride | partial | Read the LED sign as 'VOLVO 7900 HYBRID'; it says 'HYBRIDE'. Dropped the final letter (2 of 10 annotators wrote the same). |
| [textvqa_38911](results/viz/textvqa__textvqa_38911.jpg) | where is this library? | Chinatown | chinatown | hit | 10/10 annotators gave this answer |
| [textvqa_38990](results/viz/textvqa__textvqa_38990.jpg) | was the mystery machine van in the cartoon scooby doo? | Yes | yes | hit | 8/10 annotators gave this answer |

### 5. Document VQA: 5/6

**What it tests.** Answer a question about a scanned document page.

**Source.** Mathew et al., *DocVQA: A Dataset for VQA on Document Images*, WACV 2021.

**Scoring.** ANLS (normalised edit similarity, 0 below 0.5). Hit = ANLS >= 0.8.

| Sample | Question | Kimi said | Truth | Verdict | Note |
|---|---|---|---|---|---|
| [docvqa_49398](results/viz/docvqa__docvqa_49398.jpg) | What is the name of the Congress ? | IX International Congress of Nutrition | international congress of nutrition | hit | ANLS 1.00 |
| [docvqa_50367](results/viz/docvqa__docvqa_50367.jpg) | What is the topic of the second session? | Social Class in Epidemiology - A Need for Reclassification | Foetal damage and alcohol consumption | miss | Returned the second talk title instead of the second session heading ('Foetal damage and alcohol consumption'): it misread the programme's structure. |
| [docvqa_50716](results/viz/docvqa__docvqa_50716.jpg) | What does 'NMD3' stand for? | VLG Replacement | VLG REPLACEMENT | hit | ANLS 1.00 |
| [docvqa_53696](results/viz/docvqa__docvqa_53696.jpg) | What is written below RJReynolds logo? | Tobacco Company | Tobacco company | hit | ANLS 1.00 |
| [docvqa_54490](results/viz/docvqa__docvqa_54490.jpg) | How much did the photographs of RJR foursome cost? | $30.00 | $30.00 | hit | ANLS 1.00 |
| [docvqa_64888](results/viz/docvqa__docvqa_64888.jpg) | In Atlanta, what is the no. of stepped cases, whose living status is unknown? | 6 | 6 | hit | ANLS 1.00 |

### 6. Chart QA: 6/6

**What it tests.** Read values off a chart and do light arithmetic on them.

**Source.** Masry et al., *ChartQA*, Findings of ACL 2022.

**Scoring.** Relaxed accuracy: numbers within 5% of the label, otherwise exact match.

| Sample | Question | Kimi said | Truth | Verdict | Note |
|---|---|---|---|---|---|
| [chartqa_813](results/viz/chartqa__chartqa_813.jpg) | What is the sum of United states and United kingdom in the pie chart? | 39.27 | 39.27 | hit | exact |
| [chartqa_843](results/viz/chartqa__chartqa_843.jpg) | In which year, the estimated number of Christians in Global South exceed 1300 million? | 2010 | 2010 | hit | exact |
| [chartqa_1352](results/viz/chartqa__chartqa_1352.jpg) | How many students were enrolled in Kenyan universities in 2018/19? | 519462 | 519462 | hit | exact |
| [chartqa_1494](results/viz/chartqa__chartqa_1494.jpg) | The coronavirus pandemic resulting in movie theater closures resulted in a box office decl | 296.7 | 296.7 | hit | exact |
| [chartqa_1605](results/viz/chartqa__chartqa_1605.jpg) | How many people aged 15 or above read women's monthly magazines? | 24.9 | 24.9 | hit | exact |
| [chartqa_2444](results/viz/chartqa__chartqa_2444.jpg) | What percentage of families in Boston lived below the poverty level in 2019? | 11.7 | 11.7 | hit | exact |

### 7. Visual math reasoning: 5/6

**What it tests.** Mathematical reasoning grounded in a figure: plots, geometry, puzzles, measurement.

**Source.** Lu et al., *MathVista*, ICLR 2024.

**Scoring.** Exact answer (option text for multiple choice, value for free form).

| Sample | Question | Kimi said | Truth | Verdict | Note |
|---|---|---|---|---|---|
| [mathvista_216](results/viz/mathvista__mathvista_216.jpg) | What percentage of people like the most preferred object in the whole chart? | 90 | 90 | hit | correct |
| [mathvista_223](results/viz/mathvista__mathvista_223.jpg) | Is this an even function? | A (Yes) | Yes | hit | correct |
| [mathvista_253](results/viz/mathvista__mathvista_253.jpg) | How many objects are preferred by more than 7 people in at least one category? | 2 | 2 | hit | correct |
| [mathvista_427](results/viz/mathvista__mathvista_427.jpg) | How many people prefer the most preferred object? | 7 | 7 | hit | correct |
| [mathvista_742](results/viz/mathvista__mathvista_742.jpg) | Move the ruler to measure the length of the twig to the nearest inch. The twig is about (_ | 3 | 3 | hit | correct |
| [mathvista_979](results/viz/mathvista__mathvista_979.jpg) | What number is shown? | 9069 | 9079 | miss | Base-ten blocks: counted 6 ten-rods instead of 7, answering 9069 instead of 9079. |

### 8. Spatial-relation reasoning: 4/6

**What it tests.** Decide whether a spatial statement about two objects is true ('The truck is below the boat').

**Source.** Liu et al., *Visual Spatial Reasoning*, TACL 2023 (VSR).

**Scoring.** True/false accuracy. Kimi also boxes the two objects it reasoned about.

| Sample | Question | Kimi said | Truth | Verdict | Note |
|---|---|---|---|---|---|
| [vsr_211](results/viz/vsr__vsr_211.jpg) | The bus is facing away from the cow. | false | true | miss (ambiguous) | Judged the motion-blurred bus as facing toward the cow; annotators said 'facing away'. The bus's front is hard to read. |
| [vsr_245](results/viz/vsr__vsr_245.jpg) | The truck is next to the motorcycle. | true | true | hit | correct |
| [vsr_551](results/viz/vsr__vsr_551.jpg) | The cat is touching the keyboard. | false | false | hit | correct |
| [vsr_736](results/viz/vsr__vsr_736.jpg) | The bird is away from the refrigerator. | false | true | miss (ambiguous) | Judged the crow as close to the background refrigerator; annotators said it is 'away from' it. 'Away from' is vague here. |
| [vsr_835](results/viz/vsr__vsr_835.jpg) | The suitcase is at the edge of the bed. | true | true | hit | correct |
| [vsr_1456](results/viz/vsr__vsr_1456.jpg) | The truck is below the boat. | true | true | hit | correct |

### 9. Object hallucination probe: 3/6

**What it tests.** Yes/no questions about whether an object is present, with adversarial negatives that tend to co-occur.

**Source.** Li et al., *Evaluating Object Hallucination in Large Vision-Language Models*, EMNLP 2023 (POPE).

**Scoring.** Yes/no accuracy on a balanced 3 yes / 3 no sample. 'Yes' answers also return a box.

| Sample | Question | Kimi said | Truth | Verdict | Note |
|---|---|---|---|---|---|
| [pope_605](results/viz/pope__pope_605.jpg) | Is there a boat in the image? | yes | yes | hit | correct |
| [pope_1542](results/viz/pope__pope_1542.jpg) | Is there a chair in the image? | yes | no | miss (ambiguous) | Answered yes and boxed a chair-like seat at the top of the frame; COCO has no chair annotation for this image. |
| [pope_125](results/viz/pope__pope_125.jpg) | Is there a sandwich in the image? | yes | yes | hit | correct |
| [pope_353](results/viz/pope__pope_353.jpg) | Is there a bicycle in the image? | no | yes | miss (disputed) | COCO's 'bicycle' here is the motorcycle. Kimi answered 'no bicycle', which is correct by eye. |
| [pope_2176](results/viz/pope__pope_2176.jpg) | Is there a handbag in the image? | yes | no | miss | Hallucination: said there is a handbag and boxed the child's pink plush toy. |
| [pope_2668](results/viz/pope__pope_2668.jpg) | Is there a truck in the image? | no | no | hit | correct |

### 10. GUI element grounding: 5/6

**What it tests.** Given a UI instruction ('clear browsing data'), say exactly where to click on a screenshot.

**Source.** Cheng et al., *SeeClick: Harnessing GUI Grounding for Advanced Visual GUI Agents*, ACL 2024 (ScreenSpot).

**Scoring.** Hit = the click point falls inside the target element's box.

| Sample | Question | Kimi said | Truth | Verdict | Note |
|---|---|---|---|---|---|
| [screenspot_0](results/viz/screenspot__screenspot_0.jpg) | close | [930, 94] | annotated box | hit | click inside target |
| [screenspot_11](results/viz/screenspot__screenspot_11.jpg) | choose language for windows | [684, 151] | annotated box | hit | click inside target |
| [screenspot_315](results/viz/screenspot__screenspot_315.jpg) | set mirror display | [239, 354] | annotated box | miss (disputed) | The menu has two identical 'Mirror Display' rows. Kimi clicked the first (Color LCD display); ScreenSpot expects the second (DELL display). |
| [screenspot_608](results/viz/screenspot__screenspot_608.jpg) | clear browsing data | [1790, 1111] | annotated box | hit | click inside target |
| [screenspot_970](results/viz/screenspot__screenspot_970.jpg) | previous images | [118, 426] | annotated box | hit | click inside target |
| [screenspot_988](results/viz/screenspot__screenspot_988.jpg) | show reviews | [350, 870] | annotated box | hit | click inside target |

## What it missed

Every non-hit, after review. *Real* = the model was wrong. *Ambiguous* = the question or relation is vague; the benchmark verdict stands. *Disputed* = the benchmark label looks wrong on inspection.

**Real (6)**

- `detection/coco_1425` (Object detection, partial): Boxes were well placed, but it called the small ramekin a 'cup' (COCO says 'bowl') and added a 'dining table' box over the plate.
- `grounding/refcoco_2125874` (Referring-expression grounding, miss): Boxed the whole bench, including the half the woman sits on; the expression asks for the empty part only (IoU 0.45, just under the 0.5 bar).
- `textvqa/textvqa_38269` (Scene-text VQA, partial): Read the LED sign as 'VOLVO 7900 HYBRID'; it says 'HYBRIDE'. Dropped the final letter (2 of 10 annotators wrote the same).
- `docvqa/docvqa_50367` (Document VQA, miss): Returned the second talk title instead of the second session heading ('Foetal damage and alcohol consumption'): it misread the programme's structure.
- `mathvista/mathvista_979` (Visual math reasoning, miss): Base-ten blocks: counted 6 ten-rods instead of 7, answering 9069 instead of 9079.
- `pope/pope_2176` (Object hallucination probe, miss): Hallucination: said there is a handbag and boxed the child's pink plush toy.

**Ambiguous (3)**

- `vsr/vsr_211` (Spatial-relation reasoning, miss): Judged the motion-blurred bus as facing toward the cow; annotators said 'facing away'. The bus's front is hard to read.
- `vsr/vsr_736` (Spatial-relation reasoning, miss): Judged the crow as close to the background refrigerator; annotators said it is 'away from' it. 'Away from' is vague here.
- `pope/pope_1542` (Object hallucination probe, miss): Answered yes and boxed a chair-like seat at the top of the frame; COCO has no chair annotation for this image.

**Disputed (3)**

- `counting/countbench_379` (Object counting, miss): Kimi pointed at 5 separate slips. CountBench's label comes from the image caption ('three tickets'); at least 4-5 distinct slips are visible.
- `pope/pope_353` (Object hallucination probe, miss): COCO's 'bicycle' here is the motorcycle. Kimi answered 'no bicycle', which is correct by eye.
- `screenspot/screenspot_315` (GUI element grounding, miss): The menu has two identical 'Mirror Display' rows. Kimi clicked the first (Color LCD display); ScreenSpot expects the second (DELL display).

Detection 'hits' can still miss objects; those are listed in the detection table notes (for example an occluded teddy bear or a second mouse).

## What it did well

- **Charts and plots: 6/6 ChartQA, 5/6 MathVista.** Exact values off bar, line and pie charts, including sums.
- **Pixel-precise localisation.** RefCOCO boxes at IoU 0.91-0.98 on four of six; 5/6 ScreenSpot clicks inside the target, including small icons on 2560x1440 desktop screenshots.
- **Reading.** 5/6 TextVQA and 5/6 DocVQA, often with a correct evidence box around the text it read.
- **Counting with pointing.** 10 butterflies, 9 fruit photos, 6 chairs: each instance pointed and numbered.

## Files

- `data/manifest.json`: the 60 samples with benchmark ground truth; images in `data/<task>/`.
- `results/raw/`: every request's prompt, the model's answer, its reasoning, token usage and latency.
- `results/scored.json`, `results/scores.csv`: parsed predictions, metric, verdict per sample.
- `results/viz/`: one overlay per sample (green dashed = ground truth, magenta = Kimi).
- `results/record.html`: the visual gallery of all 60 (written locally by `scripts/build_record.py`, not committed).
- `data/audit.json`: the manual review of every non-hit.
- Re-run: `python3 scripts/fetch_samples.py && python3 scripts/run_kimi.py && python3 scripts/score.py && python3 scripts/build_record.py`.
