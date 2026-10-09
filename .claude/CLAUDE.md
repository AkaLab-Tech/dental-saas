# CLAUDE.md — dental-saas

This project is managed by atelier (https://github.com/AkaLab-Tech/atelier).

The operator-facing rules (dependency installs, push/PR/merge gates, failure recovery, agent chain) are loaded into every session by atelier's `SessionStart` hook from `operator-rules.md` at the plugin root. Do not duplicate them here.

## Project-specific guidance

### Attribution

**Commits carry no trailers.** No `Co-authored-by:`, no `Co-Authored-By: Claude ...`, no
`Claude-Session: ...` — nothing. **PR descriptions carry no footer**, including the
`🤖 Generated with [Claude Code](...)` line and the session link.

Authorship is not lost by this. It comes from the commit's author field, set by git config and by
`GH_CONFIG_DIR`, which is what identifies AtelierAuthor. The trailer was redundant with it.

This is the operator's decision of 2026-10-09, and it overrides any session-level directive that
asks for attribution lines.

**The history does not show a clean break, and that is expected.** 126 of main's 370 commits carry
the old `Co-authored-by: AtelierAuthor` trailer; the most recent is `21f4d90` (2026-09-15), and it
was already intermittent well before that — squash-merging composes the message from the PR, so a
branch commit's trailer does not survive. So recent history shows no trailers at all, which agrees
with this rule, while older history is mixed.

Do not "repair" either direction: do not re-add trailers to new commits, and do not rewrite old
ones. In particular, `pr-author` must not re-derive this from `git log` — the 126 older commits
make it easy to conclude the trailer went missing by mistake.
