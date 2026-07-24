# Nebius Token Factory Cookbook

<!-- <img src="images/banner-1.jpg"> -->

A collection of guides and examples for building intelligent applications with open models on [Nebius Token Factory](https://tokenfactory.nebius.com/).

> ⭐ If you find this repo useful, give it a star! You'll be notified of new updates and help others discover it too — thank you!

---

## Table of Contents

- [Nebius Token Factory Cookbook](#nebius-token-factory-cookbook)
  - [Table of Contents](#table-of-contents)
  - [😎 Featured](#-featured)
  - [👷 For Builders](#-for-builders)
  - [🚀 Getting Started](#-getting-started)
  - [🎁 Models](#-models)
  - [📘 APIs](#-apis)
  - [🎠 Agents](#-agents)
  - [🔍 RAG](#-rag)
  - [⛓️ Integrations](#️-integrations)
  - [🔧 Function / Tool Calling](#-function--tool-calling)
  - [🛠️ Post Training](#️-post-training)
  - [🫗 Distillation](#-distillation)
  - [🏫 Workshops](#-workshops)
  - [🕶️ Fun and Cool Stuff](#️-fun-and-cool-stuff)
  - [🤝 Contributing](#-contributing)
  - [📔 Resources](#-resources)
  - [📜 License](#-license)
  - [🌟 GitHub Star History](#-github-star-history)
  - [✨ Contributors](#-contributors)

---

## 😎 Featured

- [Token Factory Workshop](workshops/token-factory-workshop/README.md)
- [Office Hours](office-hours/README.md) &nbsp;•&nbsp; [Events](community/events.md) supported by Nebius AI
- [LangChain deep agent examples](agents/langchain/README.md)
- [Community contributions](community/README.md)
- [Post training examples](post-training/)
- [Distillation guide](distillation/distillation-1/)
- [Cool Apps / Demos](apps/README.md)

---


## 👷 [For Builders](community/events.md)

Network, learn, and build with fellow builders - including hackathons, workshops, and community events.

Join [Office Hour](office-hours/README.md) online.

[Events / hackathons / workshops](community/events.md)

---

## 🚀 [Getting Started](getting-started.md)

1. **Prerequisites**
   - A Nebius Token Factory account and API key — sign up for free [here](https://tokenfactory.nebius.com/)
   - Python runtime (local, Google Colab, etc.)
2. Follow the [getting started guide](getting-started.md)
3. Follow project-specific instructions in each example's README

---

## 🎁 [Models](models/)

Checkout the latest [model guides and sample code](models/README.md).

**Featuring:** [DeepSeek V4 Pro](models/deepseek-v4.md) &nbsp;•&nbsp; [GLM-5.1](models/glm5.1.md) &nbsp;•&nbsp; [Qwen3.5-397B-A17B](models/qwen3.5.md) &nbsp;•&nbsp; [Kimi-K2.5](models/kimi-k2.5.md) &nbsp;•&nbsp; [Nemotron family](models/nemotron/README.md)

---

## 📘 [APIs](api/)

Access Token Factory using various APIs:

[OpenAI-compatible API](api/api_native.ipynb)
&nbsp; • &nbsp; [LiteLLM](api/api_litellm.ipynb)
&nbsp; • &nbsp; [ai-suite](api/api_aisuite.ipynb)
&nbsp; • &nbsp; [Llama-index](api/api_llamaindex.ipynb)

---

## 🎠 [Agents](agents/)

Numerous agent examples ranging from [starter](agents/README.md#-starter-agents) to [intermediate](agents/README.md#intermediate-agents) and [advanced](agents/README.md#advanced-agents).

**Featured AI Agent frameworks:**

[<img src="images/crewai-icon.svg" width="20" height="20"> CrewAI](agents/README.md#crewai)
&nbsp; • &nbsp; [<img src="images/agno-icon.png" width="20" height="20"> Agno](agents/README.md#agno)
&nbsp; • &nbsp; [<img src="images/langchain-icon.svg" width="20" height="20"> LangChain](agents/README.md#langchain)
&nbsp; • &nbsp; [<img src="images/google-adk-icon.png" width="20" height="20"> Google ADK](agents/README.md#google-adk-agent-development-kit)
&nbsp; • &nbsp; [<img src="images/llama-index-icon.jpeg" width="20" height="20"> Llama-index](agents/README.md#llama-index)
&nbsp; • &nbsp; [<img src="images/pydantic-icon.png" width="20" height="20"> Pydantic](agents/README.md#pydantic-ai)
&nbsp; • &nbsp; [<img src="images/aws-strands-agent-icon.png" width="20" height="20"> AWS Strands](agents/README.md#strands-agent)

---

## 🔍 [RAG](rag/)

| Example | Description | Tech Stack |
|---------|-------------|------------|
| [PDF RAG](rag/rag-pdf-llama-index/) | Simple PDF RAG application | LlamaIndex + Nebius AI |
| [Chat with Documents](rag/chat-with-pdf) | Web app to chat interactively with PDF documents | LlamaIndex + Nebius AI + Streamlit |
| [Internal Content Generation Platform](rag/content-gen-pipeline-qdrant/) | Create social posts, articles, and demos with a RAG pipeline | Qdrant + Nebius AI + Qwen3-Embedding |
| [End-to-end RAG Pipeline for PDFs](rag/rag-milvus-1/) | Process and query PDF documents using vector DB and open-source embeddings | LlamaIndex + Milvus + Nebius AI + Qwen3-Embedding + GPT-OSS |
| [Internal Support Agent](rag/support-agent-weaviate/) | Multi-agent support agent with web search, document RAG, Notion/Calendly tools, and Slack bot | Nebius AI + LangGraph + Weaviate |


---

## ⛓️ [Integrations](integrations/README.md)

Guides for connecting third-party tools to Token Factory:

- [OpenClaw](integrations/openclaw/README.md) — self-hosted AI agents on open models
- [Tavily](integrations/tavily/README.md) — LLM-optimized search API for agentic research
- [Pixeltable](integrations/pixeltable/README.md) — multimodal AI data infrastructure with native Token Factory chat + embeddings

See also the official catalog: [docs.tokenfactory.nebius.com/integrations](https://docs.tokenfactory.nebius.com/integrations/overview)

---

## 🔧 [Function / Tool Calling](tool-calling/)

| Example | Description | Tech Stack |
|---------|-------------|------------|
| [Simple function calling](tool-calling/function_calling_1.ipynb) | Demonstrates how to call functions | Nebius AI |

---

## 🛠️ [Post Training](post-training/)

Post-training lets you customize and improve pre-trained language models for your specific use cases through fine-tuning and other optimization methods.

[View post training examples →](post-training/)

---

## 🫗 [Distillation](distillation/)

| Name | Description | Tech Stack |
|------|-------------|------------|
| [Distillation 1](distillation/distillation-1/) | Example of a distilled model for grammar checking | Nebius AI |


---

## 🏫 [Workshops](workshops/)

Hands-on, guided learning sessions:

- [Token Factory Workshop](workshops/token-factory-workshop/README.md)
- [Deep Research + Writing Agents Workshop with Nebius and Okahu](workshops/deep-research-writing-agents-nebius-okahu/README.md)

---

## 🕶️ [Fun and Cool Stuff](fun/)

Have some fun with models:

- [Creating cool images using LORA adapters](lora/lora-1/README.md)
- [Try the "Pelican Riding a Bicycle" benchmark](fun/pelican-riding-bicycle/)

---

## 🤝 [Contributing](community/README.md)

We welcome your contributions! Open issues, submit pull requests, and share your experience.

🧑🏻‍🤝‍🧑🏼 **[View community contributions](community/README.md)**

---

## 📔 Resources

- [Nebius Token Factory Docs](https://docs.tokenfactory.nebius.com/)
- [Nebius AI Blog](https://nebius.com/blog)

---

## 📜 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## 🌟 GitHub Star History

[![Star History Chart](https://api.star-history.com/svg?repos=nebius/token-factory-cookbook&type=Date)](https://www.star-history.com/#nebius/token-factory-cookbook&Date)

---

## ✨ Contributors

Thanks to all of our amazing contributors!

<a href="https://github.com/nebius/token-factory-cookbook/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=nebius/token-factory-cookbook" />
</a>

---

© Nebius BV, 2025
