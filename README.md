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

TODO:
1. Implement custom rules such as:
a. Allow users to select entire months that should be considered a priority for PTOs
b. Specify the max number of long breaks (more than 7 days) and adjust accordingly 
c. Blackout dates — days/weeks the user cannot take off (e.g. a known busy sprint, exam period, or on-call rotation). Hard-exclude these from the gap search entirely.
d. Anchor dates - "I already have a wedding on June 14th, build PTO around it" - treat a fixed date as a pinned holiday-equivalent and optimize gaps around it.
Trip shape constraints
e. Min/max trip length distribution — e.g. "give me at least 2 trips of 4–6 days and 1 trip of 10+ days" rather than just capping long breaks.
f. Trip count target — "I want exactly 5 separate trips this year" as a hard constraint, which changes the knapsack into a cardinality-constrained variant.
g. Minimum gap between trips — prevent two trips landing back-to-back (e.g., require at least 2 weeks between the end of one bridge and the start of the next), useful for people who don't want back-to-back time away from work.
Multi-person / team constraints

Output & UX features
a. Multiple scenario comparison — generate 2–3 alternative optimized calendars (e.g. "max total days off" vs "max long trips" vs "evenly spread") and let the user pick, rather than a single answer.
b. What-if slider — expose alpha and max_pto_per_gap as UI sliders so users see the trade-off live (more days off vs. more spread) without needing to understand the math.
c. Efficiency score per gap — show "this trip costs 2 PTO days for 9 days off (4.5x ratio)" next to each suggested block, so users understand why a date range was picked.
d. Carry-over / expiry handling — many companies let unused PTO carry over with a cap or expire by a certain date; factor in "these 3 days expire March 31" as an earlier-in-year weighting.
Singapore-specific touches (given your repo name)
e. SG public holiday-in-lieu logic — Singapore observes a "holiday falls on Sunday → next working day off" rule; make sure your calendar generator handles that correctly, since it directly affects gap detection.
f. School holiday overlay — for users with kids, overlay MOE school holiday periods so the optimizer can prefer or avoid aligning PTO with them (some people want the opposite of what school holidays offer, since travel is pricier then).