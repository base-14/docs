---
slug: role-of-product-manager
date: 2026-10-04
title: "Building is cheap. Owning it is not."
description: "The product manager's job in three questions: what should we build, what happened after we shipped, and who is doing the work, now that building is cheap."
authors: [ranjan-sakalley]
image: ./0-mindmap.png
unlisted: false
tags:
  - product-management
  - product-discovery
  - prioritisation
  - experimentation
  - craftsmanship
  - engineering
  - ai
---

*The role of the product manager today.*

A product manager's job today comes down to three questions: what should we
build, what happened after we shipped, and who is doing the work? The PM answers
for a business result across all three, with craftsmanship as the standard.

<!--truncate-->

![Mind map of the job of a PM: what to build, what happened and who is
building, each with its sub-topics, and craftsmanship as the standard under all
three](./0-mindmap.png)

## Why the job needs restating

![Before and now: the cost of building a feature shrank while the cost of
owning it, in attention, complexity, sales and support, stayed the
same](./1-why-the-job-needs-restating.png)

A small team with modern tools, including AI assistants, can prototype an idea
in an afternoon. That makes it reasonable to ask what a product manager is still
for.

Building has become cheaper, but ownership has not. Every feature that ships
competes for customer attention, adds complexity to the product and may have to
be sold and supported for years. As teams build more, neither customer attention
nor the capacity of sales and support grows to match. The constraint is choosing
what deserves to exist.

Someone has to make those choices and answer for the result. It could be a
founder or an engineering lead. A dedicated PM earns their salary by improving
the odds: backing more bets that pay off and ending weak ones sooner. They also
take responsibility for a number the business cares about.

Many PMs answer for that number without controlling the roadmap or the release
date. Where the call is theirs, so is the miss. Where it is not, they answer for
the evidence and the recommendation they brought to whoever made it.

## What to build?

![Ideas from customers, the team, sales and leadership pass through
the job to be done and business viability, then into a ranked list of build now,
later, and not doing with reasons](./2-what-to-build.png)

### Business viability and prioritisation

A feature customers love can still sink a company if it cannot be sold,
supported or paid for. A ranked roadmap is a spending decision. It commits the
team's salaries for weeks and the company's support capacity for years.

Strategy sets the outcome. The PM turns that outcome into a number the team can
move this quarter, one that leads to retention or revenue, such as trial-to-paid
conversion. They agree on the number and its target with their manager. For bets
too big to resolve within a quarter, they agree on useful evidence along the
way, such as a paid pilot.

The PM then ranks the bets most likely to move the number and writes down which
good ideas the team will leave alone, along with the reasons. Without that
second list, a roadmap can easily become a collection of additions rather than a
set of choices.

If the ranking or the number is handed to you, be able to explain it, and bring
evidence that tests it: a count of support tickets, the reasons deals were lost,
what three customers said.

### Where ideas come from

The best ideas rarely start with the PM. Customers know their problems.
Engineers know what has just become possible. Support sees what breaks, while
sales hears why deals are lost. The PM's creative work is to keep those channels
open, connect what they hear and credit the people who brought the ideas.

Increasingly, those ideas arrive as working demos, which can be more persuasive
than they deserve to be. A demo answers one question: can we build it? The PM
still has to decide whether the result is worth owning and should judge every
demo, including the founder's, by the problem it solves.

### Jobs to be done and discovery

People hire a product to make progress on something. Clayton Christensen's
commuters bought a milkshake to make a long drive less dull, so its rivals were
bagels and doughnuts. To find the job, ask sales or support to put you on calls
with recent buyers and recent leavers. Ask what those customers were trying to
do when they switched.

Solution discovery is the continuing work of testing ways to do that job. A PM
can now build the first prototype and should be as critical of it as they would
be of anyone else's. If a bet is cheap and easy to undo, put it in front of a
few customers and watch what they do. If it is costly or hard to reverse,
interview and test prototypes before anyone builds the real thing.

## What happened?

![Predict, ship, observe and report as a cycle, with a hypothetical
one-line prediction naming the number, the size, the date, the cost, the
guardrail and the removal rule](./3-what-happened.png)

Shipping is the midpoint. The team still has to find out what happened and
report it honestly.

### Observability and data analysis

Before the build starts, write down the prediction in one line. Name the number
that should move, the size and timing of the expected change, the cost, the
guardrail and the result that would justify removing the feature. For example:

> Trial-to-paid, 8% today, beats a control group by one point by 31 March, for
> six team-weeks of work. Refunds must not rise. Under half a point, we remove
> it.

If nothing measures the number yet, make the measurement part of the work.

After launch, check usage and the steps where people drop out. Look at errors,
speed, support tickets and sales calls as well. A before-and-after comparison
can be distorted by the season or another launch. If you have enough traffic,
hold back a control group of randomly chosen users who do not get the change. If
you do not, as in much B2B software, predict something the feature alone can
move, such as its own completion rate. Add customer conversations and be honest
that the final verdict is a judgement.

### Humility

In a 2009 paper on experimentation at Microsoft, Ronny Kohavi and colleagues
reported that only about a third of well-run experiments improved the metric
they were meant to improve. Assume your ideas are no better. Conviction will not
tell you which third you are holding.

A written prediction cannot be quietly revised. Without one, analysis becomes a
hunt for numbers that flatter the launch. Compare the result with the
prediction, then report it to whoever agreed on the number, along with a
recommendation to keep, change or remove the feature. Removal has a price, but
it also ends the ongoing cost of a feature that missed.

A missed bet is normal, and at those odds, so is a short run of them. Finding
out late is the worrying part. Over two or three quarters, a PM should expect to
be judged on whether the bets they backed moved the agreed number and how
quickly and cheaply they found the misses.

You may not own the roadmap, but you own the prediction and the report. That
record is how a PM earns a say in what gets built next.

## Who is building?

![The PM carries the same why to engineering, design, sales and
support, and the quality bar rises from a rough experiment for a few users to a
general release](./4-who-is-building.png)

### Communicate like a missionary

A PM ships nothing alone. Marty Cagan argues for teams of missionaries, who
believe in the problem, rather than mercenaries, who build what they are told.
People make many small decisions every week without you. They make them well
only if they understand the customer and the goal.

- Teach what you know that others do not, which is usually the customer. Share
  the evidence with the conclusion. Bring engineers and designers to customer
  calls, walk through the numbers and make sure everyone can explain how the
  business makes money.
- Say the same thing in every room, every week, until you hear it repeated back.
  When the strategy changes, say so and explain why. Take your doubts and
  evidence to whoever set the direction. Tell the team what has been decided and
  what remains open.

### Be the gatekeeper for quality and polish

A missionary team owns its own quality, and the PM is its last check before a
general release. Use the product as a new customer would and note every
hesitation, whether it is a blank first screen, a slow page or a confusing word.

Delay is as real a cost as a defect, so the bar rises with the stakes. An
experiment shown to a few users can be rough; a general release cannot. Agree
the bar with the team at the start so that everyone holds it. When something
ships below the bar, give the fix an owner and a date.

## Craftsmanship

![Passable next to crafted: a bare payment failed error beside a
card declined message that says what to do, and a vague onboarding brief beside
one naming the customer, job, number and review date](./5-craftsmanship.png)

Craftsmanship means telling passable from good and caring enough to close the
gap, both in the product and in your own work. In the product, it might be a
checkout that explains why a card was declined. In the PM's work, it is a brief
that names the customer, the job, the number and the review date.

Craft matters more as tools improve. AI can produce a passable spec, analysis or
design in minutes, so more passable work arrives at the gate. A team may need
fewer PMs. The ones it keeps will be able to spot the difference between
passable and good, then spend the time they save with customers and inside the
product.

You train that eye by studying the best products you use and rewriting your own
work until a newcomer can act on it. Craft takes time, so spend it first where
customers and money meet: sign-up, checkout and pricing.

## The loop

![What to build and what happened form a loop of deciding and
learning, who is building keeps the loop running, and craftsmanship sits under
all three](./6-the-loop.png)

The first two questions repeat: decide, learn, then decide again. Answering the
third keeps that cycle running when you are not in the room, and craft
determines how well the team handles it.

A weekly test for any PM:

1. Can I explain why our top priority is the top priority, which number it
   should move, and what we are not doing?
2. Do I know whether the agreed number is moving, and how long our last miss ran
   before we caught it?
3. Could everyone on the team say what we are building and why?
4. Would I put my name on what we are about to release?

A "no" points to next week's work.

## Sources

- [Online Experimentation at
  Microsoft](https://ai.stanford.edu/~ronnyk/ExPThinkWeek2009Public.pdf),
  Kohavi, Crook, Longbotham and others, 2009: the one-third finding.
- [Clay Christensen's Milkshake
  Marketing](https://www.library.hbs.edu/working-knowledge/clay-christensens-milkshake-marketing),
  Carmen Nobel, HBS Working Knowledge, 2011.
- [Missionaries vs.
  Mercenaries](https://www.svpg.com/missionaries-vs-mercenaries/), Marty Cagan,
  SVPG, 2015, crediting John Doerr. Doerr's original distinction was about
  entrepreneurs: [Knowledge at
  Wharton](https://knowledge.wharton.upenn.edu/article/mercenaries-vs-missionaries-john-doerr-sees-two-kinds-of-internet-entrepreneurs/),
  2000.
