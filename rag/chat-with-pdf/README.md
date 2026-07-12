# Chat with PDF Documents

![demo](./assets/demo.gif)

A powerful RAG (Retrieval-Augmented Generation) chat application built with Streamlit, LlamaIndex, and Nebius AI's Qwen3 model. This application allows users to upload PDF documents and interact with them through an AI-powered chat interface.


## Features

- 📄 PDF Document Upload and Preview
- 💬 Interactive Chat Interface
- 🤖 Powered by Qwen3-235B-A22B Model
- 🔍 Advanced RAG Implementation using LlamaIndex
- 🎯 High-quality Embeddings with Qwen/Qwen3-Embedding-8B
- 🔄 Real-time Document Processing
- 💭 Transparent AI Reasoning Display

## Prerequisites

- Python 3.10
- Nebius AI [API Keys](https://tokenfactory.nebius.com/?modals=create-api-key)

## Installation

**1. Clone the repository**

```bash
git   clone    https://github.com/nebius/token-factory-cookbook/
cd rag/chat-with-pdf
```

**2. Install the required packages:**

If using `uv`

```bash
uv sync
```

If using `pip`

```bash
pip install -r requirements.txt
```

**3. Set up your environment variables:**
   
Create a `.env` file in the project root and add your Nebius API key:

```text
NEBIUS_API_KEY=your_api_key_here
```

## Running

1. Run the Streamlit application:

If using uv

```bash
uv run streamlit  run main.py
```

If using pip

```bash
streamlit run main.py
```

2. Open your web browser and navigate to the provided local URL (typically http://localhost:8501)

3. Upload a PDF document using the sidebar

4. Start chatting with your document!

## Features in Detail

### Document Processing

- Supports PDF file uploads
- Real-time document preview in the sidebar
- Automatic document indexing using LlamaIndex

### Chat Interface

- Clean and intuitive chat UI
- Support for multiple message types
- Clear chat history functionality
- Expandable AI reasoning display

### Model Options

- Primary: Qwen3-235B-A22B
- Alternative: DeepSeek-V3
- Embedding Model: Qwen/Qwen3-Embedding-8B

## Architecture

The application uses a combination of:

- Streamlit for the web interface
- LlamaIndex for document processing and RAG implementation
- Nebius AI's models for embeddings and generation
- PyPDF2 for PDF handling

## Contributing

Feel free to submit issues and enhancement requests!

## Credits

This example is adopted with thanks from [here](https://github.com/Arindam200/awesome-ai-apps/tree/main/rag_apps/qwen3_rag)