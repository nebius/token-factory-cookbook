# /// script
# requires-python = ">=3.12"
# dependencies = ["openai>=2.48.0,<3"]
# ///
"""Make one Inkling 2 Small request through Nebius Token Factory."""

import os

from openai import OpenAI

client = OpenAI(
    api_key=os.environ["NEBIUS_API_KEY"],
    base_url="https://api.tokenfactory.nebius.com/v1/",
)

response = client.chat.completions.create(
    model="thinkingmachines/Inkling-2-Small",
    messages=[{
        "role": "user",
        "content": (
            "Revenue grew from $120M to $150M while operating margin fell from 18% to 15%. "
            "Did operating income rise or fall, and by how much? Show the arithmetic."
        ),
    }],
)

print(response.choices[0].message.content)
