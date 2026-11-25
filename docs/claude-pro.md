# Automatic Claude reviews in the app

This Mac app runs the user's installed, unmodified Claude Code client with its existing subscription sign-in. It uses documented non-interactive CLI mode (`-p`) and structured output, without an API SDK request, token extraction, Terminal window or pasted prompt. This is personal automation of the native client on the owner's Mac, not a public Pro-backed inference service or third-party Claude login.

## Normal workflow

Log sets and finish a workout, save food entries, or edit your routine. The server detects changed evidence, batches nearby edits for 20 seconds and runs a background review. Open **Coach** to see progress and the saved review. You can select **Review now** or pause/resume automation there. The app refreshes the visible coach panel every five seconds.

The server skips unchanged evidence. Automatic reviews run at most once per 15 minutes and 12 times per rolling 24 hours; an explicit Review now can request a fresh review. Rate limits pause retries for an hour; other failures wait 15 minutes. No automatic retry purchases credits, switches authentication or enables extra usage. The native client remains subject to the subscription's limits and the user's account-level extra-usage settings.

Set `COACH_PROVIDER=subscription` and `CLAUDE_AUTO_COACH=true` in private `.env`. The Mac service already has these settings. The older API integration remains disabled even if an old API key or `AUTO_COACH=true` exists. To pause automatic reviews, use the panel or set `CLAUDE_AUTO_COACH=false` and restart. Local deterministic reports continue working.

## What is run

The app discovers a working standalone or official IDE-extension binary, verifies `claude.ai` subscription authentication, then invokes its non-interactive structured-report mode. Training/nutrition context goes through stdin, not process arguments. API/provider credential environment variables are removed. The client uses no filesystem/shell tools, loads no MCP servers for these jobs, skips user/project settings, and does not persist the CLI chat session. It runs from a temporary working directory. `--bare` is not used, because that mode does not use subscription sign-in.

The app validates the structured report, enforces evidence requirements and bounded volume suggestions, and saves it as `coach_reports.mode='claude_pro'`. It never applies programme changes. If relevant data changed while Claude was generating, the result is discarded and a later review uses fresh evidence. Previous saved reviews survive failures. Jobs/statuses persist in `coach_jobs`; requests are serialized and stuck/interrupted jobs recover after a timeout. The runner has a four-minute process deadline.

Claude's authentication stays in its own client/keychain. An expired or unavailable sign-in is shown in the app as requiring a one-time sign-in through the official client; the app cannot log in for you. It never accepts or stores OAuth tokens. Data supplied for the review is sent through the native client to Anthropic, as in a normal Claude conversation. Pro allowance is consumed; API credits are not used as a fallback.

## Optional interactive coaching

The local `aesthetic-lab` MCP connection and `/aesthetic-audit` skill remain available in Claude Code. They provide `get_aesthetic_context`, `get_review_schema` and `save_aesthetic_review`, with context-fingerprint validation and normal client tool permissions. They are optional, not part of the automatic app workflow.

`Coach with Claude Pro.command` is an optional interactive launcher/connection-repair aid. `.venv/bin/python scripts/claude_coach.py --check` verifies native-client discovery/sign-in without starting a model request. The launcher can fall back to the official VS Code extension's native client if a standalone CLI path is unavailable during an update.

After moving the workspace, regenerate optional MCP configuration with `.venv/bin/python scripts/setup_claude_pro.py`. Machine-local `.mcp.json` and Claude private settings are excluded from source distribution.

Sources: [Claude Code non-interactive automation and structured output](https://code.claude.com/docs/en/headless), [Claude Code with Pro/Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan), [authentication and native-client use](https://code.claude.com/docs/en/legal-and-compliance).
