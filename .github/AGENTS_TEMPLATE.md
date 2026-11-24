# Agent instructions: recipe name

<!--
Copy this file to AGENTS.md in the recipe folder and fill it in. It is read by
a coding agent that a user has pointed at the folder with "set this up for me".

- Write commands the agent can run as they are, from the recipe folder.
- Mark every step that needs a person with **Ask the user**: adding a key,
  choosing between options that cost money, paid runs, anything outside the
  folder, sign-ins.
- State only what you ran. Before you submit, copy the recipe to a scratch
  folder and have a fresh agent follow this file alone; fix whatever made it
  guess.
- Show the output of a working run and say which parts vary, so the agent
  does not compare numbers.
- For a server, say how to tell it is up and that it must be stopped.
- In a Next.js recipe, `next dev` appends its own block to AGENTS.md. Run it
  once and commit the block, so a reader's working tree stays clean.
- Link this file from the recipe README, for example:
  "Setting this up with a coding agent? Point it at AGENTS.md."
- Delete this comment.
-->

For a coding agent asked to set this recipe up. `README.md` in this folder is
the version for people.

**Done means:** one command and the output that proves the recipe works.

## Rules

- Run every command from this folder.
- Never open, print or echo `.env`, and never ask for the API key in chat. The
  user types the key into the file. To add a setting, append a line. Loading
  the file into a command with `. ./.env` is fine.
- Rules specific to this recipe: where model IDs come from, and any file
  outside this folder that the recipe changes.
- Steps marked **Ask the user** need an answer before you go on. Do everything
  else without asking.

## Steps

1. Check the tools the recipe needs and their minimum versions. If one is
   missing, **ask the user** before installing it.

2. Install the recipe's dependencies inside this folder.

3. Create `.env` unless it exists.

   ```bash
   [ -f .env ] || cp env.example .env
   ```

4. **Ask the user** to open `.env`, add their Token Factory key after
   `NEBIUS_API_KEY=`, save, and tell you when it is done. Keys are created at
   <https://tokenfactory.nebius.com>.

5. Run the checks that are free and need no key.

6. **Ask the user** whether you may make the paid requests, and say what they
   cost. On a yes, run the recipe. On a no, skip to the hand-back and say the
   paid run was not made.

7. Compare the output with what a working run prints.

## If it fails

| Output | What to do |
| --- | --- |
| An error the recipe is known to produce | The fix, as a command where possible |

## Hand back to the user

Tell them what was set up and what you ran, how to run it themselves, what
only they can do, and how to remove everything.
