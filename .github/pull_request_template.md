<!--
The title of this pull request becomes the commit message on main, because the
repository squash-merges. Write it as a Conventional Commit:

    feat(lesson): add listen-and-repeat recorder to the study card
    fix(progress): stop awarding replay XP twice after a refresh

CI will reject the title if it does not match. See docs/process/engineering-workflow.md
in the docs repository for the full list of types.
-->

## What and why

<!-- One paragraph. What changes for a learner, a contributor, or the next developer?
     Not a list of files — the diff already says that. -->

## Deliverable

<!-- Which investor deliverable this advances. D1..D12, or `none` for genuine
     maintenance. This line is how the week-12 evidence pack assembles itself, so it
     is not optional. If you cannot name one, ask whether this work should be
     happening this week. Reference: docs/release/deliverables.md -->

Deliverable: D

Closes #

## How I know it works

<!-- Be specific. "Tested locally" tells the reviewer nothing. Name the case you
     actually exercised, or the test you added, or the preview URL and what to click. -->

## Checklist

- [ ] The four gates pass locally: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`
- [ ] Behaviour I fixed or added has a test, or I have said below why it does not
- [ ] I checked the Vercel preview on a phone-width viewport, not only on desktop
- [ ] Documentation is updated, or is genuinely unaffected
- [ ] No secret, key or `.env` file is in this diff
- [ ] Evidence for the deliverable above is linked on the board item

<!-- Delete any that do not apply, and say why. An unticked box with a reason is
     fine. An unticked box with no reason means the pull request is not ready. -->

## Anything the reviewer should look at hardest

<!-- Where you are least sure. Naming it gets you a better review than "LGTM?". -->

---

<!--
REVIEWER: five questions, in this order.

  1. Does this do what the description says, and nothing else?
  2. What breaks if the input is empty, duplicated, or arrives twice?
  3. Is there an existing function that already does this? (lib/progress.ts and
     components/ui/ both already contain more than you remember)
  4. Will the next person understand this in six months without asking?
  5. Does anything here need to be written down as a decision (an ADR) rather than
     discovered later in the diff?

A review that takes under ten minutes on a non-trivial change is not a review. If you
are approving without reading, say so instead — an honest "merging unreviewed, low
risk, here is why" is better than a rubber stamp that looks like scrutiny.
-->
