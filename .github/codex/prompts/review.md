# Pull request review

Review only the changes introduced by this pull request. The checkout is GitHub's synthetic merge
commit; use its first parent as the base when inspecting the diff.

Follow every applicable `AGENTS.md`, including its review guidelines. Focus on defects that could
cause incorrect behavior, security or authorization regressions, data loss, broken deployments,
or material performance degradation. Verify findings against the surrounding implementation and
tests before reporting them. Do not modify files.

For each finding, provide:

- severity (`P0` or `P1`)
- file and line
- the concrete failure mechanism and user impact
- the smallest credible fix

Do not report style preferences, speculative risks, or pre-existing problems. If there are no P0
or P1 findings, respond exactly: `No blocking findings.`
