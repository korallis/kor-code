---
name: pr-standard
description: Writes clear pull request titles and bodies. Use when opening, editing or reviewing a pull request or changelog entry.
license: MIT
metadata:
  kor.kind: standard
  kor.stages: review,ship
  kor.triggers: open pull request; write PR description; review PR; changelog
  kor.anti: implementing or refactoring code
  kor.visibility: public
  kor.budget: "1000"
---

# PR standard

Read the repository's pull request template and contribution rules first. Its
section names and delivery policy take precedence over the default below.

## Title

Use `type(scope): plain-language outcome`, without a trailing period. Types:
`feat`, `fix`, `refactor`, `perf`, `docs`, `ci`, `chore`. Name an area a maintainer
recognises and say what becomes true, such as `fix(search): retain filters after reopening`.

## Body

Start with the [body template](references/template.md), replacing its prompts.

1. **What does this PR do?** Explain what changes for the user and why, for a
   reader who has not seen the conversation. Include the cause when it helps
   assess a fix. Keep file lists and process narration out of the prose.
2. **Changelog.** One line per user-visible change, starting `Added:`, `Changed:`
   or `Fixed:`. For maintenance with no user-visible change, remove the section
   and write a brief "no changelog" note.
3. **How was it tested?** State the actual commands or real app flows checked,
   their results and material gaps. Distinguish a build from exercising a feature.
4. **Screenshots.** Include before and after for visual changes. Remove this
   section for a nonvisual change unless the repository requires it.
5. **Checklist.** Use the project's acceptance criteria. Tick only verified
   claims; mark N/A with a reason or leave incomplete checks unticked.

## Before opening

Keep the PR focused on one outcome. Read the diff and body once as the reviewer,
checking that the title describes the final change. Update README and docs in the
same PR when installation, commands, configuration or visible behaviour changes.
Remove secrets, personal data and internal paths from text and captures. Follow
the repository's issue-linking rules and open ready for review unless its policy
requires a draft. Finish when every claimed result has evidence.
