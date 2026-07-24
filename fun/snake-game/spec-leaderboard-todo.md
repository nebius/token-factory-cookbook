# Snake game - demo mode

## Overview

For overall spec see [game-spec.md](game-spec.md)

## Demo mode

- In this mode the game will run contiously
- At the start 2 models will be randomly chosen 
- They will do 3 games.  The winner is chosen by 2 out of 3
- Winning model will stay.
- Losing model will be replaced by another random model
- And they will battle 3 games .. and so on.
- Make sure when seleting random models, not to choose previously chosen models.
- If a model doesn't respond to 3 API calls consequently, it is declared as forfeit.  And match ends.  Other model wins.
- after the game ends, we display a winner banner.
- and a count down timer of 10 seconds and next match starts

## Leaderboard

- we maintain a leaderboard of models playing the game
- keep track of games played, games won and lost, moves and length
- have a button to show leaderboard popup anytime.

## Game controls

- we will have a 'demo' section
- a 'demo mode' button.  This button activates after we 'load models'
- a 'leaderboard' button.  This will show leaderboard
- 'pause' and 'restart' buttons to pause and start demo games