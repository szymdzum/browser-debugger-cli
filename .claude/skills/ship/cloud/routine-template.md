<!-- Red-team routine prompt (first run S27, #864). render.mjs replaces {{ROUND}}, {{AGENT}}, {{SHA}}, {{AREA}}, {{TARGETS}}, {{COVERED}} with agents/<agent>.md and emits the RemoteTrigger create body. -->
You are a red-team tester of a CLI called bdg (it drives and debugs a Chrome browser through the Chrome DevTools Protocol; its users are coding agents who trust its output). Your goal: **make bdg lie or crash** in one area, and prove it. A lie is bdg output that contradicts what the page really is or did: a ✓ for an action with no effect, a wrong verdict, a missing or wrong value, an element reported that isn't there, a wrong exit code or `--json` field. A crash is a stack trace, a hang past its own timeout, a session left half-dead, or leftover processes.

## Part 1: setup (run exactly this)

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch -q origin && git checkout -q --detach {{SHA}}
npm ci --silent && npm run build --silent
mkdir -p /tmp/r-bin /tmp/r-{{AGENT}}-pages
printf '#!/bin/sh\nexec node %s/dist/index.js "$@"\n' "$PWD" > /tmp/r-bin/bdg && chmod +x /tmp/r-bin/bdg
cat > /tmp/r-env.sh <<ENV
export CHROME_PATH="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)"
export BDG_SESSION_DIR=/tmp/r-{{AGENT}} PATH=/tmp/r-bin:\$PATH BDG_ATTACH_REQUIRE_WS_URL=1
ENV
. /tmp/r-env.sh && bdg --version
```
Start every shell call with `. /tmp/r-env.sh`. `bdg` is a script on `PATH`, so `timeout`, `env` and `xargs` run it too.

**Your own pages.** Write HTML (and small Node servers when you need headers, delays, redirects or broken responses) under `/tmp/r-{{AGENT}}-pages/`, and serve them on `127.0.0.1` (`python3 -m http.server 0 --directory /tmp/r-{{AGENT}}-pages` or `node server.mjs`, in the background, printing the port). The repository's test pages are there too: `npx tsx src/__testutils__/serveFixtures.ts > /tmp/fixtures.log 2>&1 &` prints a `fixtures:` URL. You may read bdg's help (`bdg --help`, `bdg <cmd> --help`, `bdg --help --json`), `docs/CLI_REFERENCE.md`, `.claude/skills/bdg/SKILL.md` and the source under `src/` to aim your attacks. Don't edit anything in the repository except your report directory.

## Part 2: your area

{{AREA}}

Attack ideas (a starting point; go beyond them):
{{TARGETS}}

Already covered by existing tests, so only worth trying in new combinations: {{COVERED}}

## Rules of evidence

A finding counts only with **all three**:
1. **The page**: its file, copied into `reports/{{AGENT}}/pages/` (a self-contained HTML file, or the server script that serves it), or the URL of a public page.
2. **The bdg command and its exact output and exit code** (`echo "exit $?"` after it), run from a fresh session (`bdg <url>` first).
3. **An independent check that contradicts it**: raw CDP through `bdg cdp …` (e.g. `bdg cdp Runtime.evaluate --params '{"expression":"…"}'`), a screenshot you describe, or the page's own script output (a log the page writes to `document.title`, the console or a server log). Say exactly which line of bdg's output is false and what the check shows instead.

Also give the shortest reproduction (a shell block from an empty `/tmp` that serves the page and runs the commands). Run it twice: a finding that shows up once in five runs is still a finding, but say the rate. Say when you think the cause is this machine (Linux, root, headless Chromium, traffic through a proxy). No proof, no finding: list a suspicion without proof under "Unproven", not as a finding.

Work: one bdg session at a time; `bdg stop` when done with a page; to send Ctrl-C, spawn the command from a small Node script that calls `child.kill('SIGINT')` after N ms and prints exit code, stdout and stderr. Don't open GitHub issues. Don't attach to any Chrome you didn't start (`bdg attach` only with `--chrome-ws-url`). At most about 150 tool calls in all; stop attacking at ~130 and write the report.

## Part 3: report

Write `reports/{{AGENT}}/report.md`:
- **Findings**, most serious first, each as `### F<n>: <one-line claim>` with: kind (lie about an action / wrong data / crash / contract: exit code or `--json`), the page file, the bdg command with output and exit code, the independent check with output, the reproduction, the rate, the environment suspicion.
- **Held**: attacks you tried that bdg handled correctly, one line each (they matter as much: they tell us what not to test again).
- **Unproven**: suspicions without proof.
- The bdg version and commit you tested, and tool calls used.

Then publish it:
```bash
git switch -q -c cloud-round/{{ROUND}}-{{AGENT}}
git add -f reports/{{AGENT}} && git commit -qm "cloud round {{ROUND}}: {{AGENT}} red-team report"
git push -q origin HEAD
```
If the push fails, print the whole report instead, in parts of at most 1800 characters each, titled `REPORT {{AGENT}} PART i/n`, with the pages' HTML as extra parts. Each part is its own message: write one part, then run `true` with Bash, then write the next part (a message holding several parts gets cut off at about 2000 characters).
