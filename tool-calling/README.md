# Function / Tool Calling Examples

Some examples showing how to do function/tool calling in Nebius Token Factory

## References and Acknowledgements

- [API documentation](https://docs.tokenfactory.nebius.com//inference/quickstart)
- [Tool calling docs](https://docs.tokenfactory.nebius.com//inference/tool-calling)

## Prerequisites

- Nebius API key (get it from [Nebius Token Factory](http://tokenfactory.nebius.com/))

## Function Calling Explained

[Function calling explained](function-calling-explained.md)

![](function-calling-explained.svg)

## Setup

**1. Using Google Colab**

No setup needed.  Run the notebook and it will install all dependencies


**2. (Local) Using uv (recommended)**

```bash
uv venv
source .venv/bin/activate
uv  pip install  -r requirements.txt
python -m ipykernel install --user --name="cookbook-1" --display-name "cookbook-1"
```

**3. (Local) Using python / pip**

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m ipykernel install --user --name="cookbook-1" --display-name "cookbook-1"
```

## Running the code

**Using Jupyter**

```bash
jupyter lab
```

And select the kernel defined above and run notebooks.

**Using vscode and other IDEs**

Restart vscode so it will refresh available kernels.  Then select it and run it.


## Examples


| Example                             | Description                                         | Tech Stack                         |
|-------------------------------------|-----------------------------------------------------|------------------------------------|
| [simple function calling example](function_calling_1.ipynb) | Demonstrates how to call functions                          | Nebius AI     |
| [Tavily tool calling example](tavily_tool_calling.ipynb) | Demonstrates how to implement research agent with Tavily search                          | Nebius AI, Tavily search    |

