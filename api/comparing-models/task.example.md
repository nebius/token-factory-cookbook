Write a Python function that parses an ISO 8601 duration such as PT1H30M into
seconds. Support days, hours, minutes, and seconds. Reject years and months
because their duration depends on the calendar. Explain edge cases and include
pytest tests for valid inputs and invalid inputs.

Success criteria:
- PT1H30M returns 5400 and P1DT2H returns 93600.
- PT0S returns 0.
- Empty strings, negative durations, bare P or PT, and unsupported units raise
  ValueError.
- The function and tests can be copied into files and run locally.
