# PAL MCP Integration with Nebius Token Factory

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/nebius/token-factory-cookbook/blob/main/agents/pal-mcp-integration/pal_nebius_tutorial.ipynb)
[![](https://img.shields.io/badge/Powered%20by-Nebius-orange?style=flat&labelColor=darkblue&color=orange)](http://tokenfactory.nebius.com/)

## Overview

This tutorial demonstrates how to integrate **Nebius Token Factory** with **PAL MCP Server** to orchestrate multiple open-source AI models through Claude Code. PAL MCP (Provider Abstraction Layer - Model Context Protocol) acts as a bridge that allows Claude Code to collaborate with multiple AI models, creating a powerful multi-model development workflow.

### What You'll Learn

- **PAL MCP Fundamentals**: Understanding how PAL MCP enables multi-model orchestration
- **Nebius Integration**: Connecting Claude Code to Qwen3, DeepSeek, Llama, GLM, and GPT-OSS models
- **Multi-Model Consensus**: Using different models to debate and reach better decisions
- **Collaborative Code Review**: Leveraging multiple models for comprehensive code analysis
- **Advanced Workflows**: Combining reasoning models for complex problem-solving

### Why PAL MCP + Nebius?

**PAL MCP** provides:
- Multi-model orchestration from a single Claude Code session
- Conversation continuity across different AI models
- Specialized tools for code review, debugging, consensus building
- Context isolation via CLI-to-CLI bridging

**Nebius Token Factory** provides:
- Access to top open-source models (Qwen3-235B, DeepSeek-R1, GPT-OSS-120B)
- OpenAI-compatible API for seamless integration
- Extended context windows (up to 262K tokens)
- Reasoning models with chain-of-thought capabilities

**Together**, they enable workflows like:
- Claude Code orchestrates → Qwen3 analyzes → DeepSeek-R1 reasons → Consensus achieved
- Multi-model code reviews combining different AI perspectives
- Context-aware debugging with specialized model selection

## Prerequisites

### Required Accounts & Tools

1. **Claude Code CLI** - [Install here](https://claude.ai/code)
   ```bash
   # Verify installation
   claude --version
   ```

2. **Nebius Token Factory Account** - [Sign up](https://tokenfactory.nebius.com/)
   - Get your free API key from the dashboard

3. **PAL MCP Server** - [GitHub Repository](https://github.com/BeehiveInnovations/pal-mcp-server)
   - Will be installed during setup

### System Requirements

- **Python**: 3.10 or higher
- **uv**: Package manager (recommended) - [Install guide](https://docs.astral.sh/uv/getting-started/installation/)
- **Git**: For cloning repositories
- **Operating System**: Linux, macOS, or Windows with WSL

## Quick Start (5 Minutes)

### Step 1: Get Your Nebius API Key

1. Visit [Nebius Token Factory](https://tokenfactory.nebius.com/)
2. Sign up for a free account
3. Navigate to the API Keys section
4. Copy your API key

### Step 2: Install PAL MCP Server

```bash
# Clone PAL MCP repository
cd ~/Desktop  # or your preferred location
git clone https://github.com/BeehiveInnovations/pal-mcp-server.git
cd pal-mcp-server

# Run automatic setup (handles environment, dependencies, and Claude Code config)
./run-server.sh
```

The setup script will:
- Create a Python virtual environment
- Install all dependencies
- Prompt for your Nebius API key
- Configure Claude Code to use PAL MCP
- Set up model preferences

### Step 3: Configure Environment

Edit `~/Desktop/pal-mcp-server/.env` to add your Nebius API key:

```bash
# Nebius Token Factory Configuration
NEBIUS_API_KEY=your_api_key_here

# Optional: Model Restrictions (leave empty for all models)
# NEBIUS_ALLOWED_MODELS=nebius-qwen3,nebius-deepseek-r1,nebius-gpt-oss

# Recommended: Default model selection
DEFAULT_MODEL=auto  # Let Claude choose the best model

# Tool Configuration (enable/disable specific PAL tools)
DISABLED_TOOLS=analyze,refactor,testgen,secaudit,docgen,tracer
```

### Step 4: Verify Installation

```bash
# Start Claude Code
claude

# In Claude Code, test PAL MCP:
"Use pal to list available Nebius models"
```

You should see output listing models like:
- `nebius-qwen3` (Qwen3-235B)
- `nebius-deepseek-r1` (DeepSeek-R1)
- `nebius-gpt-oss` (GPT-OSS-120B)
- `nebius-llama` (Llama-3.3-70B)
- And more!

## Available Nebius Models via PAL MCP

| Model | Alias | Context | Best For |
|-------|-------|---------|----------|
| **Qwen/Qwen3-235B-A22B-Instruct-2507** | `nebius-qwen3` | 262K | General reasoning, coding |
| **Qwen/Qwen3-235B-A22B-Thinking-2507** | `nebius-qwen3-thinking` | 262K | Extended reasoning tasks |
| **openai/gpt-oss-120b** | `nebius-gpt-oss` | 128K | OpenAI-style reasoning |
| **deepseek-ai/DeepSeek-R1-0528** | `nebius-deepseek-r1` | 128K | Chain-of-thought reasoning |
| **deepseek-ai/DeepSeek-V3.2** | `nebius-deepseek` | 128K | General purpose, fast |
| **meta-llama/Llama-3.3-70B-Instruct** | `nebius-llama` | 128K | Balanced performance |
| **zai-org/GLM-4.5** | `nebius-glm` | 128K | Vision + function calling |
| **Qwen/Qwen2.5-VL-72B-Instruct** | `nebius-qwen-vl` | 128K | Vision tasks |

## Core PAL MCP Tools

### Collaboration & Planning

- **`chat`** - Direct conversation with specific models
  ```
  "Use pal chat with nebius-qwen3 to explain this algorithm"
  ```

- **`consensus`** - Multi-model debate and decision-making
  ```
  "Get consensus from nebius-qwen3, nebius-deepseek-r1, and nebius-gpt-oss on the best approach"
  ```

- **`thinkdeep`** - Extended reasoning with thinking models
  ```
  "Use pal thinkdeep with nebius-deepseek-r1 to analyze this edge case"
  ```

- **`planner`** - Break down complex projects
  ```
  "Use pal planner with nebius-qwen3 to create a migration strategy"
  ```

### Code Quality

- **`codereview`** - Professional multi-pass code reviews
  ```
  "Perform a codereview using nebius-qwen3 and nebius-gpt-oss"
  ```

- **`precommit`** - Validate changes before committing
  ```
  "Use pal precommit with nebius-deepseek to check my changes"
  ```

- **`debug`** - Systematic root cause analysis
  ```
  "Debug this error with nebius-deepseek-r1"
  ```

### Utilities

- **`clink`** - CLI-to-CLI bridging for isolated contexts
  ```
  "clink with cli_name='codex' role='reviewer' to audit the auth module"
  ```

- **`apilookup`** - Force current API documentation lookups
  ```
  "Use pal apilookup to get the latest Nebius API documentation"
  ```

- **`challenge`** - Critical analysis (prevents "yes-man" responses)
  ```
  "Challenge this approach with nebius-gpt-oss"
  ```

## Example Workflows

### Multi-Model Code Review

```
In Claude Code:
"Perform a codereview using nebius-qwen3 and nebius-deepseek-r1,
then use planner with nebius-gpt-oss to create a fix strategy,
and finally do a precommit check with nebius-qwen3"
```

This workflow:
1. Qwen3 performs initial code review
2. DeepSeek-R1 provides reasoning-focused second review
3. GPT-OSS creates implementation plan
4. Qwen3 validates final changes

### Consensus-Based Architecture Decision

```
In Claude Code:
"Use consensus with nebius-qwen3, nebius-deepseek-r1, and nebius-gpt-oss
to decide: should we use microservices or monolith for this project?"
```

Each model provides its perspective, and Claude synthesizes a final recommendation.

### Extended Reasoning Debug Session

```
In Claude Code:
"Use thinkdeep with nebius-deepseek-r1 to debug this race condition,
then validate the fix with nebius-qwen3"
```

DeepSeek-R1's chain-of-thought reasoning helps identify subtle bugs.

## Tutorial Contents

The accompanying Jupyter notebook (`pal_nebius_tutorial.ipynb`) covers:

1. **Setup & Configuration**
   - Installing PAL MCP Server
   - Configuring Nebius integration
   - Testing the connection

2. **Basic Usage**
   - Listing available models
   - Simple chat interactions
   - Model capability exploration

3. **Multi-Model Consensus**
   - Setting up consensus workflows
   - Comparing model responses
   - Synthesizing decisions

4. **Code Review Workflows**
   - Single-model reviews
   - Multi-model collaborative reviews
   - Pre-commit validation

5. **Advanced Patterns**
   - Combining thinking models
   - Vision model integration (GLM-4.5, Qwen-VL)
   - Custom model selection strategies

## Troubleshooting

### PAL MCP Not Found in Claude Code

**Problem**: Claude Code doesn't recognize PAL tools

**Solution**:
```bash
# Check MCP server configuration
cat ~/.claude/settings.json

# Verify PAL MCP is listed under mcpServers
# Restart Claude Code after configuration changes
```

### Nebius API Key Issues

**Problem**: "API key not found" or "Invalid API key"

**Solution**:
```bash
# Check .env file
cat ~/Desktop/pal-mcp-server/.env | grep NEBIUS_API_KEY

# Ensure no extra spaces or quotes
# Restart PAL MCP server
cd ~/Desktop/pal-mcp-server
./run-server.sh
```

### Model Not Available

**Problem**: "Model not found" when specifying a Nebius model

**Solution**:
```bash
# Check allowed models configuration
cat ~/Desktop/pal-mcp-server/.env | grep NEBIUS_ALLOWED_MODELS

# If set, ensure your desired model is in the list
# Leave empty to enable all models
NEBIUS_ALLOWED_MODELS=
```

### Timeout Errors

**Problem**: Requests to Nebius timeout

**Solution**:
Edit `.env` to increase timeouts:
```bash
# Increase timeout values (in seconds)
CUSTOM_READ_TIMEOUT=1800.0
CUSTOM_WRITE_TIMEOUT=1800.0
```

## Best Practices

### Model Selection Guidelines

- **Quick tasks**: Use `nebius-llama-8b` or `nebius-gemma`
- **General coding**: Use `nebius-qwen3` or `nebius-gpt-oss`
- **Deep reasoning**: Use `nebius-deepseek-r1` or `nebius-qwen3-thinking`
- **Vision tasks**: Use `nebius-glm` or `nebius-qwen-vl`

### Cost Optimization

- Use `DEFAULT_MODEL=auto` to let Claude choose cost-effective models
- Enable `NEBIUS_ALLOWED_MODELS` to restrict expensive models
- Start with smaller models for exploration, scale up for production

### Workflow Design

- **Single model**: Simple queries, quick validations
- **Two models**: Review + validation workflows
- **Three+ models**: Consensus, complex decision-making

## Additional Resources

- [PAL MCP Documentation](https://github.com/BeehiveInnovations/pal-mcp-server/blob/main/docs/index.md)
- [Nebius Token Factory Docs](https://docs.tokenfactory.nebius.com/)
- [Claude Code Documentation](https://claude.ai/code)
- [Model Context Protocol Spec](https://modelcontextprotocol.com/)

## Contributing

Found issues or have improvements? Contribute to:
- [PAL MCP Server](https://github.com/BeehiveInnovations/pal-mcp-server)
- [Token Factory Cookbook](https://github.com/nebius/token-factory-cookbook)

## License

This tutorial is part of the Nebius Token Factory Cookbook and follows the same license terms.
