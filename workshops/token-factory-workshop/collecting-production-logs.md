# Collecting Production Logs

Next, we capture **real-world usage data** to improve model performance.

<img src="images/coninious-ai-loop.png" width="400px">

## Datalab

Data Lab is the unified workspace inside Nebius Token Factory for working with inference logs (chat completions) and datasets.

With datalab, you can:

- collect inference logs
- dataset preparation
- run batch inference outputs 
- and fine-tuning using the logs

[datalab documentation](https://docs.tokenfactory.nebius.com/data-lab/overview)

<img src="images/data-lab-1.png" width="400px">


## Exercise 1: Collect inference logs

Try `import collections` and try out a few options.

## Exercise 2: Upload your data

We can also upload our custom data to datalab.

Here is some conversational logs.  They are in `jsonl` format - very common format, each line is a JSON object.

- [training_data.jsonl](../../post-training/fine-tuning-1/sample-data/training_data.jsonl)
- [validation_data.jsonl](../../post-training/fine-tuning-1/sample-data/validation_data.jsonl)

We will use this data later for fine tuning.