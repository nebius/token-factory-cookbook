-- Dollar cost per call: the provider's price for the model times the call's real token counts.
ALTER TABLE runs ADD COLUMN cost_usd REAL;
