<!-- AREA -->
This is a short environment check before the real red-team round, not an attack. Do these and report each result in one or two lines:
1. Write a page `/tmp/r-smoke-pages/index.html` with `<title>Smoke page</title>` and a button that sets `document.title = 'clicked'`; serve it with `python3 -m http.server 0` (or a Node server if python3 is missing) and say which you used. Start a session on it, click the button with bdg, and show bdg's output; then show the title through raw CDP: `bdg cdp Runtime.evaluate --params '{"expression":"document.title"}'`.
2. Take a screenshot of the page with bdg and say whether the file exists and its size.
3. Start the repository's test pages (`npx tsx src/__testutils__/serveFixtures.ts`) and start a session on the printed `fixtures:` URL; report the title.
4. Check that `https://the-internet.herokuapp.com/redirect` and `https://expired.badssl.com/` are reachable from this machine with bdg (what bdg prints and its exit code).
5. Copy your page into `reports/smoke/pages/` and publish the report as Part 3 says; the push itself is part of the check.
<!-- TARGETS -->
- none: this is the environment check.
<!-- COVERED -->
not applicable.
