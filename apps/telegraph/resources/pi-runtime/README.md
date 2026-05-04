Bundled Pi runtime resources.

- Place platform-specific Pi CLI binaries under `bin/` before packaging.
- Use `pnpm --filter telegraph run prepare:pi-runtime` to copy local `pi`.
  - CI-friendly: set `PI_BIN=/absolute/path/to/pi` to copy from explicit path.
- Use `pnpm --filter telegraph run ensure:pi-runtime` to auto-prepare if missing.
- Use `pnpm --filter telegraph run verify:pi-runtime` to validate before release.
- At runtime, Telegraph resolves Pi in this order:
  1) `PI_BIN` environment variable
  2) bundled `resources/pi-runtime/bin/pi` (or `pi.exe` on Windows)
  3) system `pi` on PATH

`pi-subagents` extension is resolved from app dependencies and passed via
`--no-extensions --extension <resolved-path>` to ensure deterministic behavior.
