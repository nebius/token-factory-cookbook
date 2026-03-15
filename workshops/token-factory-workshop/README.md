# Token Factory Workshop

## 🔗 `bit.ly/4cCCNzV`

<kbd>
<img src="qrcode-workshop.png" width="300px">
</kbd>

---

## Pointers

- Workshop run file (this one): `bit.ly/4cCCNzV`
- slides (coming)
- community and support @ Nebius Discord
  - [join link](https://discord.gg/sJvzdEDr)
  - [Nebius.Build.SF hackathon channel](https://discord.com/channels/1222156136380235877/1479546242307588276) - questions, finding teams ...etc
  - [Token Factory support](https://discord.com/channels/1222156136380235877/1387298727835861113)
- Also see below for more [resources](#resources)

## Prerequisites

Before starting the workshop, make sure you have:

* A **[Nebius Token Factory](https://tokenfactory.nebius.com/)** account
* (optinal) 🎁 credits.  [Use this link](https://nebius.com/promo-code?utm_promo_event_code=2026-03-hackathon-nebius-build-sf) - activation code will be provided at the event

---

## Workshop Theme

### Building Production-Grade AI Applications

<kbd>
<img src="images/coninious-ai-loop.png" style="float:right;" width="300px">
</kbd>

Modern AI applications improve continuously through a **production feedback loop**:

1. Start with **base (stock) models**
2. **Collect production logs** from real usage
3. **Fine-tune or shape models** using real production data
4. **Deploy the improved model**

This iterative process enables teams to progressively build **robust, production-ready AI systems**.

⭐️ **Token Factory has the complete workflow built-in** ⭐️ 

<br clear="both">

---

## 0 — Getting Started

Begin by setting up your environment and verifying access.

➡️ **[Getting Started Guide](getting-started.md)**

---

## 1 - Using Models

In this section, we explore how to use models hosted on **Token Factory**.

➡️  [explore Token Factory UI](explore-token-factory.md)

➡️ [structured-output](structured-output.md): Produce structured output like JSON from LLMs.

➡️ [tool calling](tool-calling.md): Extend LLMs capability by providing them with functions/tools.

➡️ [search agent with Tavily](tavily-search.md)


---

## 2 - Collecting Production Logs

Next, we capture **real-world usage data** to improve model performance.

➡️ [Collecting Production Logs](collecting-production-logs.md)

---

## 3 - Customizing / Shaping  Models

Learn how to adapt models for our specific use cases.

➡️ [fine tuning models](fine-tuning.md) - improve model performance by **training on production data** and other optimizations.

➡️ [Distilling models](distillation.md) - create smaller, efficient models.

---

## 4 - Deploy and Monitor

Deploy trained models and monitor their performance in real time.

[dedicated end points](dedicated-endpoints.md)

---

## 5 - Integration with Coding Agents

Integrate models with **coding assistants** like Cline, Cursor and Claude Code.

[coding integrations](../../coding/README.md)

---

## 6 - Fun and Games

A few experimental and creative examples to explore what else is possible.

🐍 **[*snake game](../../fun/snake-game/README.md)** 🐍 - the classic snake game, but LLMs control the snakes in real time!

🪿 **[Pelican riding a bicycle](../../fun/pelican-riding-bicycle/README.md)** - a fun 'vibe benchmark' to gauge model intelligence!

<kbd>
<img src="images/snake-game-1.png" width="400px">
</kbd>

---

## Resources

- [Token Factory cookbook](https://github.com/nebius/token-factory-cookbook/) - lots of examples
- [dev.nebius.com](https://dev.nebius.com/): Hub or nebius developer resources
- [awesome ai apps](https://github.com/Arindam200/awesome-ai-apps/) - a great repo with lots of examples with Nebius Token Factory

---

## Dev Notes

Project setup using **uv**:

```bash
uv init --python=3.12

uv add openai python-dotenv pydantic tavily-python
uv add --dev ipykernel

# (optional) generate requirements.txt
uv export \
  --frozen \
  --no-hashes \
  --no-emit-project \
  --no-default-groups \
  --output-file=requirements.txt
```


