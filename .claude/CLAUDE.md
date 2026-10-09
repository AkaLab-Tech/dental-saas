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

**The history is split in two styles on purpose, at `62b5cec`.** Every commit up to that point
carries the old `Co-authored-by: AtelierAuthor` trailer; every commit after it carries none.
Comparing an old commit with a new one shows a decision, not drift — do not "repair" the
inconsistency in either direction, neither by re-adding trailers to new commits nor by rewriting
old ones.

`pr-author` must not re-derive this from `git log`. The old trailer dominates by volume and will
for a long time, so a sample of recent history will keep suggesting the superseded convention.
