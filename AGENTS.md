<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors

<!-- nx configuration end-->

## Bundle budget tooling

This is a Bun-first workspace with inherited Node-hosted Nx/Vite. Build and report
measurement share Bun's default gzip authority, not the caller's compressor.
Core limits live in `tools/core-bundle-budget.ts` (170 KiB raw / 52 KiB gzip,
45 KiB gzip soft warning). See `.github/skills/bundle-check/SKILL.md` for focused
Nx tooling tests and `.github/copilot-instructions.md` for the user's standing
permission to make justified future increases. That permission does not authorize
commits or remote operations.
