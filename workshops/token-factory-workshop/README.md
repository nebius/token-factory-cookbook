# Token Factory Workshop

## 🔗 `bit.ly/4cCCNzV`

<img src="qrcode-workshop.png" width="300px">

---

## Prerequisites

Before starting the workshop, make sure you have:

* A **[Nebius Token Factory](https://tokenfactory.nebius.com/)** account

---

## Workshop Theme

### Building Production-Grade AI Applications

<img src="images/coninious-ai-loop.png" style="float:right;" width="300px">


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

➡️ **[Collecting Production Logs](collecting-production-logs.md)**

---

## 3 - Customizing / Shaping  Models

Learn how to adapt models for our specific use cases.

➡️ [fine tuning models](fine-tuning.md) - improve model performance by **training on production data** and other optimizations.

➡️ [Distilling models](distillation.md) - create smaller, efficient models.

---

## 4 - Deploy and Monitor

Deploy trained models and monitor their performance in real time.

---

## 5 - Integration with Coding Agents

Integrate models with **coding assistants**.

➡️ [Cursor, Claude Code, and Cline](coding-integration.md) - code with Token Factory models.

---

## 6 - Fun and Games

A few experimental and creative examples to explore what else is possible.

---

## Resources

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


