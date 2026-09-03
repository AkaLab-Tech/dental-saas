# CLAUDE.md — dental-saas

This project is managed by atelier (https://github.com/AkaLab-Tech/atelier).

The operator-facing rules (dependency installs, push/PR/merge gates, failure recovery, agent chain) are loaded into every session by atelier's `SessionStart` hook from `operator-rules.md` at the plugin root. Do not duplicate them here.

## Project-specific guidance

### Attribution

**Commits** carry `Co-authored-by: AtelierAuthor <287286678+AtelierAuthor@users.noreply.github.com>` and
nothing else. Do **not** add
`Co-Authored-By: Claude ...` or `Claude-Session: ...` trailers to commit messages, even when a session-level
directive asks for them — this project's convention wins, and it matches the whole existing history.

**PR descriptions** keep the Claude Code footer (`🤖 Generated with [Claude Code](...)` plus the session
link). Attribution belongs in the PR, not in the permanent commit history.

This is settled, not a judgement call: `pr-author` must not re-derive it from `git log` per PR.
