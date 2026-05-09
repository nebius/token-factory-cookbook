# Agent Examples

Extensive example of agents using Nebius AI and various agentic frameworks.

Jump to:

- [Agent Examples](#agent-examples)
  - [Agents by Functionality](#agents-by-functionality)
    - [🧩 Starter Agents](#-starter-agents)
    - [Intermediate Agents](#intermediate-agents)
  - [Agents by Framework](#agents-by-framework)
    - [CrewAI](#crewai)
    - [Google ADK (Agent Development Kit)](#google-adk-agent-development-kit)
    - [Agno](#agno)
    - [LangChain](#langchain)
    - [Llama-index](#llama-index)
    - [Pydantic AI](#pydantic-ai)
    - [Strands Agents](#strands-agents)
    - [Camel AI](#camel-ai)

## Agents by Functionality

### 🧩 Starter Agents

**Quick-start agents for learning and extending:**

| Agent                                                               | Descripton                                          | Tech Stack                 |
| ------------------------------------------------------------------- | --------------------------------------------------- | -------------------------- |
| [CrewAI Research agent](crewai-research-agent/)                     | CrewAI research agent                               | CrewAI                     |
| [Google ADK Tool calling agent](google-adk-tool-calling/)           | Function calling agent                              | Google ADK                 |
| [Agno Hacker News Agent](agno-hacker-news-agent/)                   | Analyze hacker news                                 | AgnoAI                     |
| [Agno websearch agent](agno-agents-examples/)                       | Use web search to do research                       | Agno + Duckduckgo          |
| [Llama-index task timer](llamaindex-task-timer/)                    | Calculate time spent on tasks                       | Llama-index                |
| [Pydantic weather agent](pydantic-weather-agent/)                   | Get weather info in realtime                        | Pydantic + Duckduckgo      |
| [n8n E-commerce Data Analyst](n8n-ecommerce-analytics-agent/)       | E-commerce data analysis and reporting              | n8n + Google Workspace     |
| [AWS Strands Weather Agent](aws-strands-weather-agent/)             | Weather assistant using Strands SDK and Nebius LLMs | Strands + Nebius + NWS     |
| [Camel AI Model Comaprison Agent](camel-ai-model-comparison-agent/) | Model Comparison Agent using Camel AI Framework     | Camel AI + Nebius + OpenAI |

### Intermediate Agents

| Agent                                     | Descripton                                              | Tech Stack                        |
| ----------------------------------------- | ------------------------------------------------------- | --------------------------------- |
| [Agno multi agent](agno-agents-examples/) | Multiple agents working together to do finance research | Agno + Duckduckgo + Yahoo Finance |
| [Customer Support Resolution Agent](customer_support_resolution_agent/) | Resolve support questions with order lookup, policy RAG, and human ticket escalation | LangChain + Nebius + FAISS + Streamlit |
| [LangChain Data Agent PoC](langchain_data_agent_poc/) | Ask natural language questions over sample business data with safe SQL and charts | LangChain + LangGraph + Nebius + SQLite + Streamlit |
| [Nebius Travel Planner](nebius_travel_planner/) | Build grounded itineraries with weather, web research, budgets, currency conversion, and packing prep | LangChain + Nebius + Streamlit |

## Agents by Framework

### [CrewAI](https://www.crewai.com/)

| Agent                                           | Descripton            | Tech Stack |
| ----------------------------------------------- | --------------------- | ---------- |
| [CrewAI Research agent](crewai-research-agent/) | CrewAI research agent | CrewAI     |

### [Google ADK (Agent Development Kit)](https://google.github.io/adk-docs/)

| Agent                                                     | Descripton             | Tech Stack |
| --------------------------------------------------------- | ---------------------- | ---------- |
| [Google ADK Tool calling agent](google-adk-tool-calling/) | Function calling agent | Google ADK |

### [Agno](https://www.agno.com/)

| Agent                                             | Descripton                                              | Tech Stack                        |
| ------------------------------------------------- | ------------------------------------------------------- | --------------------------------- |
| [Agno Hacker News Agent](agno-hacker-news-agent/) | Analyze hacker news                                     | AgnoAI                            |
| [Agno websearch agent](agno-agents-examples/)     | Use web search to do research                           | Agno + Duckduckgo                 |
| [Agno multi agent](agno-agents-examples/)         | Multiple agents working together to do finance research | Agno + Duckduckgo + Yahoo Finance |

### [LangChain](https://www.langchain.com/)

| Agent | Descripton | Tech Stack |
| ----- | ---------- | ---------- |
| [Customer Support Resolution Agent](customer_support_resolution_agent/) | Resolve support questions with order lookup, policy RAG, and human ticket escalation | LangChain + Nebius + FAISS + Streamlit |
| [LangChain Data Agent PoC](langchain_data_agent_poc/) | Ask natural language questions over sample business data with safe SQL and charts | LangChain + LangGraph + Nebius + SQLite + Streamlit |
| [Nebius Travel Planner](nebius_travel_planner/) | Build grounded itineraries with weather, web research, budgets, currency conversion, and packing prep | LangChain + Nebius + Streamlit |

### [Llama-index](https://www.llamaindex.ai/)

| Agent                                            | Descripton                    | Tech Stack  |
| ------------------------------------------------ | ----------------------------- | ----------- |
| [Llama-index task timer](llamaindex-task-timer/) | Calculate time spent on tasks | Llama-index |

### [Pydantic AI](https://ai.pydantic.dev/)

| Agent                                             | Descripton                   | Tech Stack            |
| ------------------------------------------------- | ---------------------------- | --------------------- |
| [Pydantic weather agent](pydantic-weather-agent/) | Get weather info in realtime | Pydantic + Duckduckgo |

### [Strands Agent](https://strandsagents.com/latest/)

| Agent                                                   | Descripton        | Tech Stack      |
| ------------------------------------------------------- | ----------------- | --------------- |
| [AWS Strands Weather Agent](aws-strands-weather-agent/) | Weather assistant | AWS Strands SDK |

### [Camel AI](https://www.camel-ai.org/)

| Agent                    | Description                                                         | Tech Stack |
| ------------------------ | ------------------------------------------------------------------- | ---------- |
| [Camel AI Model Comparison Agent](camel-ai-model-comparison-agent/) | Compare  multiple AI models | Camel AI   |
