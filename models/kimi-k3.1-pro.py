# /// script
# requires-python = ">=3.12"
# dependencies = ["openai>=2.48.0,<3"]
# ///
"""Make one Kimi K3.1 Pro request through Nebius Token Factory."""

import os

from openai import OpenAI

client = OpenAI(
    api_key=os.environ["NEBIUS_API_KEY"],
    base_url="https://api.tokenfactory.nebius.com/v1/",
)

response = client.chat.completions.create(
    model="moonshotai/Kimi-K3.1-Pro",
    messages=[{
        "role": "user",
        "content": "Write a Python function that retries a request up to three times with exponential backoff.",
    }],
)

print(response.choices[0].message.content)
