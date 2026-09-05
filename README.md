The core problem with the naive objective to ONLY maximize PTO 

If your objective is just maximize Σ days_off, then every PTO day is worth exactly the same regardless of where you spend it. The optimizer doesn't care whether the 10 days-off it produces come from one megatrip or five small trips — a day off is a day off. So it will always greedily go to wherever the marginal PTO day buys the most days off, and that's almost always next to an existing holiday cluster, because holidays are already doing some of the work for you.

Example: say you have two gaps:

Gap A: a holiday falls on Thursday. Spend 1 PTO day (Friday) → get a 4-day weekend (Thu–Sun). That's 4 days off per 1 PTO day spent — great ROI.
Gap B: no holiday nearby. Spend 1 PTO day → get a 3-day weekend (adjacent to a normal Sat/Sun). That's 3 days off per 1 PTO day — still good, but slightly worse ROI.

If you have 2 PTO days left, a pure sum-maximizer will ask: "where does the next PTO day do the most good?" It'll check if spending PTO day #2 in Gap A (bridging further, e.g. taking Wed too, turning Wed–Sun into 5 days off) beats spending it in Gap B. Often it does, because Gap A already has momentum. So the optimizer keeps stacking into Gap A even though the incremental gain is now smaller than what Gap B would give you for a first day off there.

Suggestions to improve the algorithm to maximize PTO while avoiding clustering:

1. Add constraints, not just an objective
Instead of "maximize total days off," add rules like:
a. Max PTO days usable per holiday-cluster/gap (caps how much you can pile onto one gap)
b. Min number of separate trips, or min spacing between trips
c. One "big" allocation (e.g. 5+ consecutive days) reserved for summer, rest capped at 2–3 days elsewhere

2. Segment the year first, then optimize per segment
Split into buckets (e.g. quarters, or "before summer" / "summer" / "after summer"), allocate a sub-budget of PTO days to each bucket, then run the optimization independently per bucket. This guarantees spread by construction rather than hoping the objective function produces it.

3. Change the objective function itself (multi-objective)
Instead of maximizing sum of days off, maximize something like:

score = Σ (days_off_in_gap)^α   for α < 1

A concave function (e.g. square root, log) diminishes the marginal value of stacking more days into an already-good gap, naturally pushing the optimizer to spread PTO across multiple gaps rather than dumping everything into the single best one. This is a well-known trick in resource-allocation problems (it's basically enforcing diminishing returns to encourage diversity).

4. Weighted/preference-based ILP
If the user has explicit preferences ("I want at least one trip in each of Q1, Q2, Q3, Q4"), that's straightforward to encode as hard constraints in an ILP/CP model rather than trying to coax it out of a single objective function.

For a real product feature, #1 combined with #3 is usually the sweet spot — cap per-gap PTO spend, and use a concave reward function so the algorithm still finds efficient gaps but doesn't over-invest in any single one.