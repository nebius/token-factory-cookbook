# Tavily + Token Factory

<img src="https://www.tavily.com/logos/tavily-full.svg" alt="Tavily" width="200"/>


## About Tavily

[Tavily](https://tavily.com/) is an LLM-optimized search API built specifically for agents. It delivers clean, structured, and context-aware web results — making it ideal for research, competitive intelligence, and multi-step agentic workflows. Tavily handles query formulation, result filtering, and content extraction so your Nebius-powered agents can focus on reasoning and synthesis instead of wrestling with raw HTML. Many examples in this cookbook pair Tavily search with Nebius Token Factory models to build agents that plan, research, and produce decision-grade outputs.

- 📖 [Tavily Documentation](https://docs.tavily.com/)
- 🎮 [Tavily Playground](https://app.tavily.com/playground)

Here are some examples of Tavily and Token Factory.



| Example | Description | Tech Stack |
|-------------|-------------|------------|
| [Tavily tool calling](../../tool-calling/tavily_tool_calling.ipynb) | Jupyter notebook demonstrating Tavily tool-calling with Nebius Token Factory | Token Factory · Tavily |
| [Tavily search](../../workshops/token-factory-workshop/tavily-search.md) | Agent Search with Tavily | Token Factory · Tavily |
| [competitive research agent](../../agents/langchain/competitive-intelligence-agent/) | Deep agent example that uses 3 sub-agents to do pricing-research, news-research and sentiment-research  | LangChain deepagents · Nebius TF · Tavily |
| [Universal Deep research](../../agents/universal-deep-research-nebius/README.md) | Multi-step research pipeline with FastAPI backend + Next.js frontend; fetches web results via Tavily | FastAPI · Next.js · Nebius TF · Tavily |

