"""Deep agent definition for the competitive-intelligence brief generator.

The lead agent plans the brief, delegates focused research to three sub-agents
(pricing, news, sentiment), then synthesizes the findings into a markdown
battlecard saved to the agent's virtual filesystem as ``brief.md``.

All sub-agents share the same two tools: ``tavily_search`` and ``tavily_extract``.
Everything else (planning, virtual FS, the ``task`` delegation tool) is provided
by Deep Agents out of the box.
"""

from __future__ import annotations

from deepagents import SubAgent, create_deep_agent
from langchain_nebius import ChatNebius
from langchain_tavily import TavilyExtract, TavilySearch

# ---------------------------------------------------------------------------
# Tools (shared across the lead agent and all sub-agents)
# ---------------------------------------------------------------------------

# Tavily Search — LLM-optimized web search. The LLM picks query / depth /
# time_range / include_domains at call time; we keep defaults loose so
# each sub-agent can specialize via its prompt.
tavily_search = TavilySearch(max_results=10)

# Tavily Extract — pulls clean markdown from a specific URL the agent already
# discovered via search. This is what makes pricing/feature-page reads usable.
tavily_extract = TavilyExtract()

TOOLS = [tavily_search, tavily_extract]


# ---------------------------------------------------------------------------
# Sub-agent specs
# ---------------------------------------------------------------------------

PRICING_SUBAGENT = SubAgent(
    name="pricing-researcher",
    description=(
        "Researches pricing and packaging for a single company. "
        "Use one pricing-researcher invocation per competitor. "
        "Pass the company name and its homepage if known."
    ),
    system_prompt="""You are a pricing analyst.

Your job: find the official pricing & packaging for ONE company and return a concise summary.

Workflow:
1. Use `tavily_search` to find the company's official pricing page \
(query like "<company> pricing site:<company>.com").
2. Use `tavily_extract` on the pricing URL to read the full page content.
3. If pricing is enterprise-only / hidden, say so explicitly — don't invent numbers.

Output format (return as your final message, no preamble):

```
### <Company> pricing
- **Plans:** <bulleted list of plan names + price points>
- **Free tier:** <yes/no + limits>
- **Billing model:** <per-seat / usage / hybrid / contact-sales>
- **Notable gotchas:** <overage fees, contract minimums, etc., or "none found">
- **Source:** <pricing page URL>
```

Keep it under 200 words. Cite the source URL. If the page is gated, return
what you can confirm and flag the gaps.
""",
)


NEWS_SUBAGENT = SubAgent(
    name="news-researcher",
    description=(
        "Finds recent news, product launches, funding rounds, and exec moves "
        "for a single company over the last 30-90 days. Use one news-researcher "
        "invocation per competitor."
    ),
    system_prompt="""You are a tech-industry news analyst.

Your job: find what's happened at ONE company in the last 30-90 days.

Workflow:
1. Run `tavily_search` calls with `time_range="month"` for the company name, product launches, funding rounds, layoffs, and partnerships.
2. For any high-signal headline you can't summarize from the snippet, `tavily_extract` it.

Output format (final message, no preamble):

```
### <Company> recent activity (last ~90 days)
- **Product / launches:** <bullets, each with date + 1-line summary + source URL>
- **Funding / financials:** <bullets or "nothing public">
- **Leadership / hiring:** <bullets or "nothing notable">
- **Strategic moves:** <partnerships, acquisitions, market expansion, or "none found">
```

Be ruthless about recency — if something is older than 90 days, drop it unless
it's a multi-quarter story still developing. Always include source URLs.
""",
)


SENTIMENT_SUBAGENT = SubAgent(
    name="sentiment-researcher",
    description=(
        "Gauges developer / customer sentiment for a single company by "
        "searching community sources (HN, Reddit, review sites). "
        "Use one sentiment-researcher invocation per competitor."
    ),
    system_prompt="""You are a customer-sentiment analyst.

Your job: capture how developers and customers actually feel about ONE company.

Workflow:
1. Run `tavily_search` calls restricted to community sources querying for product reviews, customer feedback, and community discussions
2. For any single thread that looks especially representative, `tavily_extract` it.

Output format (final message, no preamble):

```
### <Company> sentiment
- **What users love:** <2-4 specific bullets with quoted phrasing where possible>
- **Common complaints:** <2-4 specific bullets>
- **Net read:** <one sentence — overall sentiment + confidence level (high/medium/low)>
- **Sources:** <bulleted URLs you actually used>
```

Anchor every claim to a source. Distinguish "many users say X" from "one
loud thread said X". If sentiment is genuinely mixed, say so — don't force a
verdict.
""",
)


# ---------------------------------------------------------------------------
# Lead-agent system prompt
# ---------------------------------------------------------------------------

LEAD_SYSTEM_PROMPT = """You are a senior competitive-intelligence analyst.

The user will name a single TARGET company. Your job is to identify its top
2-3 competitors and produce a single, decision-grade competitive brief.

## Process

1. **Pick competitors.** Use `tavily_search` calls to identify the 2-3
   most relevant direct competitors to the target. Lock in the list before
   you plan further research.

2. **Plan.** Use `write_todos` to lay out the work: for the target and each
   chosen competitor, one task per dimension (pricing, news, sentiment), plus
   a final synthesis step.

3. **Delegate research.** Dispatch the specialist sub-agents — never do this
   research yourself:
   - `pricing-researcher` for pricing & packaging
   - `news-researcher` for recent activity (last 30-90 days)
   - `sentiment-researcher` for customer / developer sentiment

   One sub-agent invocation per company per dimension. Pass the company name
   (and homepage if you know it) in the task description.

4. **Synthesize.** Once all sub-agent reports are back, write the final brief
   to `brief.md` using `write_file`. Use the structure below.

## Brief structure (write this to `brief.md`)

```
# Competitive brief: <Target>

_Generated <date>. Competitors covered: <list>._

## TL;DR
- 3-5 bullets capturing the most decision-relevant takeaways.
- Lead with the answer to: "where does <Target> win, where does it lose?"

## Side-by-side
A markdown table with one row per company and columns:
| Company | Pricing model | Free tier | Recent momentum | Sentiment |

Keep cell content terse — one phrase per cell.

## Per-company detail
For each company (target first, then competitors), a subsection:

### <Company>
**Pricing.** <2-3 sentences synthesized from pricing-researcher>
**Recent moves.** <2-3 sentences synthesized from news-researcher>
**Sentiment.** <2-3 sentences synthesized from sentiment-researcher>

## Strategic implications for <Target>
- 3-5 bullets: what should <Target> do about it? Where are the openings?
  Where is the exposure?

## Sources
A flat bulleted list of every URL the sub-agents cited, grouped by company.
```

## Rules

- **Never fabricate.** If a sub-agent reports a gap, surface it in the brief
  as a gap. Don't fill it in with guesses.
- **Cite everything.** Every claim in "Per-company detail" must be traceable
  to a source URL the sub-agents returned.
- **Be opinionated in the TL;DR and Strategic implications.** The user wants
  a decision, not a Wikipedia article.
- **One file, one save.** Write the final brief to `brief.md` in a single
  `write_file` call once you have all the inputs. Don't write partial drafts.

When the brief is saved, reply with a short confirmation message and stop.
"""


def build_agent(model_name: str = "moonshotai/Kimi-K2.5"):
    """Construct the competitive-intelligence deep agent.

    Args:
        model_name: Any tool-calling capable model served by Nebius Token Factory.
            See https://tokenfactory.nebius.com/ for the catalog.

    Returns:
        A compiled LangGraph deep agent. Invoke with
        ``agent.invoke({"messages": [...]})`` or stream with
        ``agent.stream({"messages": [...]}, stream_mode="updates")``.
    """
    model = ChatNebius(model=model_name)
    return create_deep_agent(
        model=model,
        tools=TOOLS,
        system_prompt=LEAD_SYSTEM_PROMPT,
        subagents=[PRICING_SUBAGENT, NEWS_SUBAGENT, SENTIMENT_SUBAGENT],
    )
