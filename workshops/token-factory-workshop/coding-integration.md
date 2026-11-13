# Integration with Coding Agents #

Prerequisites

1. [Create an API key](https://tokenfactory.nebius.com/project/api-keys) for authentication.

## Cursor ##

1. [Install Cursor](https://cursor.com/) for your platform.

2. Follow [these instructions](https://youtu.be/seVfmwIqQkI)

## Claude Code ##

1. [Install Claude Code](https://docs.claude.com/en/docs/claude-code) for your platform.

2. Follow [these instructions](https://youtu.be/seVfmwIqQkI?si=yDfdyNE6zYoN8sZK)
   
Install claude-code-router
```bash
   # macOS
   brew install claude-code-router

   # or via npm
   npm install -g @musistudio/claude-code-router
```

Create `~/.claude-code-router/config.json`
```bash
mkdir -p ~/.claude-code-router
nano ~/.claude-code-router/config.json
```

```json
   {
     "APIKEY": "anything",
     "HOST": "127.0.0.1",
     "PORT": 3456,
     "Providers": [
       {
         "name": "nebius",
         "api_base_url": "https://api.tokenfactory.nebius.com/v1/chat/completions",
         "api_key": "YOUR_NEBIUS_API_KEY",
         "models": ["MODEL_NAME"]
       }
     ],
     "Router": {
       "default": "nebius,zai-org/GLM-5",
       "background": "nebius,zai-org/GLM-4.5-Air",
       "think": "nebius,zai-org/GLM-5"
     }
   }
```

Update `~/.claude/settings.json`
```bash
nano ~/.claude/settings.json
```
```
   {
     "env": {
       "ANTHROPIC_AUTH_TOKEN": "anything",
       "ANTHROPIC_BASE_URL": "http://127.0.0.1:3456"
     }
   }
```

Start the router (keep this terminal open)
```bash
   ccr start
```

Open a new terminal and run Claude Code
```bash
   claude
```

### Reverting to Anthropic
To switch back to the default Anthropic API:
```bash
ccr stop
```
Then set `~/.claude/settings.json` back to `{}` and restart Claude Code.

## Cline ##

1. [Install Cline](https://cursor.com/](https://cline.bot/) for your platform.

2. Follow [these instructions](youtube.com/watch?time_continue=7&v=GN85QSUzkD4&embeds_referring_euri=https%3A%2F%2Fdocs.tokenfactory.nebius.com%2F&source_ve_path=MjM4NTE)
