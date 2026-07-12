# 🧑‍🍳 AI Data Analyst Chatbot Cookbook (E-Commerce Example)

## 🍲 Ingredients

- An n8n account (self-hosted or cloud)
- A Nebius Token Factory account
- Google Sheets & Docs API credentials (OAuth)
- A copy of your example Google Sheet (e-commerce transactions or similar)

## 🛠️ Setup & Integration

### 1. Configure n8n Environment

- Sign in to your n8n account.
- Create a new workflow or import `ecommerce-analytics-agent-workflow.json` (example workflow for e-commerce analytics).

### 2. Setup Nebius LLM Node

- Use `deepseek-ai/DeepSeek-V4-Pro` from Nebius Token Factory.
- Add your Nebius API Key in credentials.
- **Example Node Configuration:**
  ```json
  {
    "model": "deepseek-ai/DeepSeek-V4-Pro",
    "options": { "temperature": 0.2 }
  }
  ```
- **Prompt Engineering:**
  ```json
  {
    "systemMessage": "You are a helpful assistant. Respond in JSON: {\"reply\":\"...\",\"doc_update\":\"...\"}"
  }
  ```

### 3. Google Sheets Integration

- Add Google Sheets OAuth credentials in n8n.
- Use your own Google Sheets link in these nodes:
  - Get transactions by status
  - Get transactions by product name
  - Get all transactions
- **Example Node Configuration:**
  ```json
  {
    "documentId": "https://docs.google.com/spreadsheets/d/your-sheet-id/edit",
    "sheetName": "Sheet1",
    "filtersUI": { "values": [{ "lookupColumn": "Status", "lookupValue": "={{ $fromAI('transaction_status', 'Status', 'string') }}" }] }
  }
  ```

### 4. Google Docs Integration

- Create a Google Doc for strategic updates.
- Add Google Docs OAuth credentials.
- Paste your document URL into the "Document Strategy" node.
- **Example Node Configuration:**
  ```json
  {
    "operation": "update",
    "documentURL": "https://docs.google.com/document/d/your-doc-id/edit",
    "actionsUi": { "actionFields": [{ "action": "insert", "text": "={{ $json['text'] }}" }] }
  }
  ```

### 5. Workflow Overview Diagram

- See `assets/workflow-diagram.png` for a visual overview.

## 📈 Workflow Deep-Dive

### 🧠 AI Agent Node
- Nebius DeepSeek powers intelligent reasoning and data analysis.
- Responds with structured JSON:
  ```json
  {
    "reply": "Short chat response (summary/tldr)",
    "doc_update": "Content to update Google Doc"
  }
  ```

### 📗 Structured Output Parser
- Ensures Nebius model's output is correctly parsed as JSON.
- **Example Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "reply": {"type": ["string", "null"]},
      "doc_update": {"type": ["string", "null"]}
    },
    "required": []
  }
  ```

### 🔎 Google Sheets Tools
- Dynamically retrieve data based on criteria:
  - Product Name
  - Transaction Status
- **Example Filter Usage:**
  ```json
  {
    "lookupColumn": "Product",
    "lookupValue": "={{ $fromAI('product_name', 'Product name', 'string') }}"
  }
  ```

### 📚 Buffer Memory
- Short-term memory (last 5 messages) ensures coherent conversations.
- **Node:** `@n8n/n8n-nodes-langchain.memoryBufferWindow`

### 🖥️ Decision Nodes
- Conditionally process responses and document updates.
- **Example If Node:**
  ```json
  {
    "conditions": {
      "options": { "caseSensitive": true, "typeValidation": "strict" },
      "conditions": [{
        "leftValue": "={{ $json['output']['reply'] !== undefined && $json['output']['reply'].trim() !== '' }}",
        "rightValue": true,
        "operator": { "type": "boolean", "operation": "equals" }
      }],
      "combinator": "and"
    }
  }
  ```

### 📌 Document & Chat Updates
- Updates strategic documents automatically.
- Provides clean, readable chat responses.

## 💡 Advanced Use Case Ideas
- **Sales Outreach Automation:** Check 100 target companies simultaneously, auto-merge insights.
- **Employee Knowledge Assistant:** Instant chatbot access to internal docs.
- **Real-Time Competitive Intelligence:** Continuously update competitive landscape docs.

## 🚀 Run Your Workflow
- Activate workflow and trigger via n8n chat interface or webhook.
- Start asking questions like:
  - "How many refunds in January and what was the amount refunded?"
  - "What's our most popular product?"

## 🛠️ Troubleshooting
- Ensure all credentials are correct and active.
- Check n8n logs for node errors.
- Validate Google API quotas and permissions.

## 📌 Additional Resources
- [Nebius Token Factory](https://tokenfactory.nebius.com/)
- [n8n Documentation](https://docs.n8n.io/)
- [Google OAuth n8n Setup Guide](https://docs.n8n.io/integrations/builtin/credentials/Google/)

---

Contributions welcome! 