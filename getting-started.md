# Setting up Dev Environment

Each project in this repo will have their own getting started.  This will setup a basic python environment.

## 1 - Clone the repo

```bash
git   clone    https://github.com/nebius/token-factory-cookbook/
cd    token-factory-cookbook
```

## 2 - Get Nebius API Key

To run most of the examples in this repo, you will need a **Nebius API Key**.  Here is how to get it.

1) Go to [tokenfactory.nebius.com](https://tokenfactory.nebius.com/)

2) Click on your profile and go to API Keys section

![](images/api-key-1.png)

3) Click on 'Get API Key'

4) Give a name for the key (e.g. 'examples1')

5) Be sure to save the key before closing the dialog window

![](images/api-key-2.png)

## 3 - Google Colab

If you are using Google Colab environment no need to setup a python environment. 

Add NEBIUS API KEY as follows (one time setup).

1.  Go to [Google Colab](https://colab.research.google.com/)
2.  Click on **Secrets** tab on left 
3.  Add a new secret **NEBIUS_API_KEY** and set the value
4.  Toggle 'Notebook access' button

![](images/google-colab-1.png)

## 4A -  Local Python Development Environment Setup

Follow the steps below for setting up a local python environment.

**Option 1 (Recommended): using UV**

[uv](https://github.com/astral-sh/uv) is our preferred package manager.

If the project is a 'native' uv project  - it has  files like `uv.lock` and `pyproject.toml`

```bash
uv sync

# run notebooks like
uv run jupyter lab notebook.ipynb

# run python scripts
uv run python code.py
```

If the project only has `requirements.txt` file (not a native UV project)

```bash
uv venv --python 3.12
source .venv/bin/activate

uv pip install -r requirements.txt

# run notebooks like
uv run jupyter lab notebook.ipynb

# run python scripts
uv run python code.py
```

You can also setup a custom kernel to use in IDEs like VSCode

```bash
source .venv/bin/activate
python -m ipykernel install --user --name="cookbook-1" --display-name "cookbook-1"
jupyter kernelspec list
```


**Option 2: Using Anaconda / mini-forge**

```bash
conda create -n nebius-cookbook-1 python=3.12
conda activate nebius-cookbook-1
pip install -r requirements.txt

# run notebooks like
jupyter lab notebook.ipynb

# run python scripts
python code.py
```

You can also setup a custom kernel to use in IDEs like VSCode

```bash
python -m ipykernel install --user --name="cookbook-1" --display-name "cookbook-1"
jupyter kernelspec list
```

**Option 3: Using Python venv**

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# run notebooks like
jupyter lab notebook.ipynb

# run python scripts
python code.py
```

You can also setup a custom kernel to use in IDEs like VSCode

```bash
source .venv/bin/activate
python -m ipykernel install --user --name="cookbook-1" --display-name "cookbook-1"
jupyter kernelspec list
```



## 4B - Setup `.env` configuration file (for Local Setup)

Use the provided `env_sample.txt` file as starter

```bash
cp   env_sample.txt   .env
```

Add your key in `.env` file as follows:

```text
NEBIUS_API_KEY=your_api_key_here
```