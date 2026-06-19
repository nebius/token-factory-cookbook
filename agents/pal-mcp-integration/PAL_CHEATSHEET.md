# PAL MCP + Nebius Token Factory Cheat Sheet

Quick reference for using PAL MCP with Nebius models in Claude Code.

## 🚀 Quick Start Commands

### List Available Models
```
use pal to list models
```

### Check PAL Version
```
use pal version
```

---

## 🤖 Model Aliases Reference

| Full Model Name | Alias | Context | Use Case |
|----------------|-------|---------|----------|
| Qwen/Qwen3-235B-A22B-Instruct-2507 | `nebius-qwen3` | 262K | General coding, reasoning |
| Qwen/Qwen3-235B-A22B-Thinking-2507 | `nebius-qwen3-thinking` | 262K | Extended reasoning |
| openai/gpt-oss-120b | `nebius-gpt-oss` | 128K | OpenAI-style reasoning |
| deepseek-ai/DeepSeek-R1-0528 | `nebius-deepseek-r1` | 128K | Chain-of-thought |
| deepseek-ai/DeepSeek-V3.2 | `nebius-deepseek` | 128K | Fast general purpose |
| meta-llama/Llama-3.3-70B-Instruct | `nebius-llama` | 128K | Balanced performance |
| meta-llama/Meta-Llama-3.1-8B-Instruct | `nebius-llama-8b` | 128K | Quick tasks |
| zai-org/GLM-4.5 | `nebius-glm` | 128K | Vision + text |
| Qwen/Qwen2.5-VL-72B-Instruct | `nebius-qwen-vl` | 128K | Vision tasks |

---

## 💬 Basic PAL Commands

### Simple Chat
```
use pal chat with nebius-qwen3 to [your question]
```

Example:
```
use pal chat with nebius-qwen3 to explain Python decorators
```

### Extended Reasoning
```
use pal thinkdeep with nebius-deepseek-r1 to [complex analysis]
```

Example:
```
use pal thinkdeep with nebius-deepseek-r1 to analyze the time complexity
```

### Get Latest API Documentation
```
use pal apilookup to get the latest [API/framework] documentation
```

Example:
```
use pal apilookup to get the latest FastAPI documentation for async routes
```

---

## 🎯 Multi-Model Workflows

### Consensus (2-4 models)
```
use consensus with nebius-qwen3, nebius-deepseek-r1, and nebius-gpt-oss
to decide: [your decision question]
```

Example:
```
use consensus with nebius-qwen3, nebius-deepseek-r1, and nebius-gpt-oss
to decide: should we use Redis or Memcached for session storage?
```

### Code Review (Single Model)
```
perform a codereview using nebius-qwen3 on [file/module]
```

### Code Review (Multi-Model)
```
perform a codereview using nebius-qwen3 and nebius-deepseek-r1 on [file/module]
```

### Planning
```
use pal planner with nebius-gpt-oss to create a plan for [task]
```

Example:
```
use pal planner with nebius-gpt-oss to create a migration plan for
moving from REST to GraphQL
```

### Pre-Commit Validation
```
use pal precommit with nebius-qwen3 to validate my changes
```

### Debugging
```
use pal debug with nebius-deepseek-r1 to investigate [error/bug]
```

Example:
```
use pal debug with nebius-deepseek-r1 to investigate this race condition
in the payment processing module
```

### Challenge Your Assumptions
```
use pal challenge with nebius-gpt-oss to critique [approach/design]
```

Example:
```
use pal challenge with nebius-gpt-oss to critique my microservices design
```

---

## 🔥 Advanced Patterns

### Complete Review → Plan → Implement → Validate
```
perform a codereview using nebius-qwen3 and nebius-deepseek-r1,
then use planner with nebius-gpt-oss to create a fix strategy,
implement the fixes,
and finally do a precommit check with nebius-qwen3
```

### Sequential Reasoning Chain
```
use thinkdeep with nebius-deepseek-r1 to analyze [problem],
then continue with nebius-qwen3-thinking to validate the analysis
```

### Multi-Model Architecture Review
```
use consensus with nebius-qwen3, nebius-deepseek-r1, and nebius-gpt-oss
to review the architecture of [component],
then use planner with nebius-gpt-oss to propose improvements
```

### Context Continuity Example
```
# Step 1: Initial analysis
use chat with nebius-qwen3 to explain microservices patterns

# Step 2: Build on previous context
now continue with nebius-deepseek-r1 to analyze potential pitfalls

# Step 3: Get consensus (sees full conversation)
get consensus from nebius-gpt-oss and nebius-llama on best practices
```

---

## 🎨 Model Selection Guide

### By Task Type

| Task | Recommended Model(s) | Why |
|------|---------------------|-----|
| Quick question | `nebius-llama` or `nebius-llama-8b` | Fast, efficient |
| Code generation | `nebius-qwen3` | Excellent coding skills |
| Deep reasoning | `nebius-deepseek-r1` | Chain-of-thought |
| Security audit | `nebius-deepseek-r1` | Analyzes attack vectors |
| Architecture review | `nebius-gpt-oss` | Balanced reasoning |
| Vision analysis | `nebius-glm` or `nebius-qwen-vl` | Multimodal |
| Extended thinking | `nebius-qwen3-thinking` | Dedicated thinking mode |
| Consensus | Mix 3 models | Diverse perspectives |

### By Intelligence Level

**High Intelligence (Premium):**
- `nebius-qwen3` (intelligence: 19)
- `nebius-qwen3-thinking` (intelligence: 19)
- `nebius-gpt-oss` (intelligence: 18)
- `nebius-deepseek-r1` (intelligence: 18)

**Balanced (Mid-tier):**
- `nebius-deepseek` (intelligence: 18)
- `nebius-glm` (intelligence: 17)
- `nebius-llama` (intelligence: 16)

**Fast & Cost-Effective:**
- `nebius-llama-8b` (intelligence: 10)
- `nebius-gemma` (intelligence: 13)

---

## ⚙️ Configuration Quick Reference

### PAL MCP .env File
```bash
# Location: ~/Desktop/pal-mcp-server/.env

# Nebius API Key (required)
NEBIUS_API_KEY=your_api_key_here

# Model Selection
DEFAULT_MODEL=auto  # Let Claude choose, or specify: nebius-qwen3, nebius-deepseek-r1, etc.

# Tool Configuration (disable heavy tools to save context)
DISABLED_TOOLS=analyze,refactor,testgen,secaudit,docgen,tracer

# Optional: Restrict available models (leave empty for all)
# NEBIUS_ALLOWED_MODELS=nebius-qwen3,nebius-deepseek-r1,nebius-gpt-oss

# Conversation Settings
CONVERSATION_TIMEOUT_HOURS=24
MAX_CONVERSATION_TURNS=40

# Timeouts (increase for large requests)
CUSTOM_READ_TIMEOUT=1800.0
CUSTOM_WRITE_TIMEOUT=1800.0
```

### Claude Code Settings
```json
// Location: ~/.claude/settings.json

{
  "mcpServers": {
    "pal": {
      "command": "/path/to/pal-mcp-server/.pal_venv/bin/python",
      "args": ["/path/to/pal-mcp-server/server.py"],
      "env": {
        "NEBIUS_API_KEY": "your_key",
        "DEFAULT_MODEL": "auto",
        "DISABLED_TOOLS": "analyze,refactor,testgen,secaudit,docgen,tracer"
      }
    }
  }
}
```

---

## 🐛 Troubleshooting

### PAL not responding
```bash
# Check Claude Code settings
cat ~/.claude/settings.json

# Restart Claude Code
# Test: "use pal version"
```

### Model not found
```bash
# Check allowed models
cat ~/Desktop/pal-mcp-server/.env | grep NEBIUS_ALLOWED_MODELS

# Leave empty to enable all
NEBIUS_ALLOWED_MODELS=
```

### Timeout errors
```bash
# Increase timeouts in .env
CUSTOM_READ_TIMEOUT=1800.0
CUSTOM_WRITE_TIMEOUT=1800.0
```

### API key issues
```bash
# Verify key format (no quotes/spaces)
cat ~/Desktop/pal-mcp-server/.env | grep NEBIUS_API_KEY

# Test direct API
curl -H "Authorization: Bearer $NEBIUS_API_KEY" \
     https://api.studio.nebius.com/v1/models
```

---

## 📚 Workflow Templates

### Template 1: Quick Task
```
chat with nebius-llama → answer
```

### Template 2: Standard Code Review
```
codereview with nebius-qwen3 → review
precommit with nebius-qwen3 → validation
```

### Template 3: Complex Decision
```
consensus with [3 models] → debate
thinkdeep with nebius-deepseek-r1 → deep analysis
planner with nebius-gpt-oss → implementation plan
```

### Template 4: Full Development Cycle
```
planner → design
chat with nebius-qwen3 → implementation
codereview with [qwen3, deepseek-r1] → review
debug with nebius-deepseek-r1 → fix issues
precommit with nebius-qwen3 → final check
```

---

## 🎓 Best Practices

### ✅ Do
- Use `auto` mode for general tasks
- Get consensus (3 models) for important decisions
- Combine thinking models for complex reasoning
- Use codereview before major commits
- Validate with precommit
- Start small, scale up
- Reference previous context

### ❌ Don't
- Use expensive models for simple tasks
- Skip validation on critical code
- Ignore consensus disagreements
- Use vision models for text-only tasks
- Exceed context limits
- Forget cost control configs

---

## 📖 Resources

- [PAL MCP Docs](https://github.com/BeehiveInnovations/pal-mcp-server/blob/main/docs/index.md)
- [Nebius Token Factory](https://tokenfactory.nebius.com/)
- [Claude Code Guide](https://claude.ai/code)
- [Full Tutorial Notebook](./pal_nebius_tutorial.ipynb)

---

**Print this cheat sheet and keep it handy! 📋**
