<!-- AREA -->
**Navigation and load failures.** Commands that start a session or navigate (`bdg <url>`, `page navigate`, `page reload`, `page back`/`forward`, `wait`, and actions that navigate: `dom click` on a link, `dom submit`) must say truthfully whether the page loaded, what failed, and what page the session is on now. Make any of them report success on a page that didn't load, name the wrong URL or status, report a failure for a page that did load, hang past its own timeout, or leave the session unusable without saying so.
<!-- TARGETS -->
- Navigations that fail **late**: a page that loads, then a client redirect (meta refresh, `location.replace` after a delay, `history.pushState` to a 404 route) to a failing URL; a 200 page whose body is empty or whose main document is replaced by `document.write`.
- Failures inside an **action**: a click that triggers a navigation to a hanging server, a form POST that returns 500 with a nice HTML body, a download instead of a page, a navigation cancelled by `beforeunload`, a link with `target=_blank` that fails in the new tab.
- **SPA navigations**: a router change that never touches the network vs one that fetches and fails; the URL bdg reports afterwards vs `location.href`.
- **Redirect chains**: 301 → 302 → 200 on another origin, HTTP → HTTPS, a redirect to a `data:` URL or `javascript:`; the status bdg reports for the final page.
- **Status vs content**: 404 with a full app page, 200 with an error page, 204, 304 on reload, a page that sets `document.title` to "Error" itself.
- **Timing**: a page whose `load` never fires (a hanging image or iframe) but whose DOM is ready; `page reload` while a slow navigation is still pending; navigating twice quickly.
- Real sites only for reachable variants of the above, e.g. `https://the-internet.herokuapp.com/redirect`, `https://expired.badssl.com/`, `https://httpbin.org/status/500` (uitestingplayground.com is blocked from this machine).
<!-- COVERED -->
direct navigations to a server that returns 204/304/404/500, resets the connection, hangs, keeps the body open, sends a truncated body, loops redirects, redirects to `chrome://` or `about:blank`, a CSP that blocks its own script, a `blob:` page, an unresolvable host, a closed port, TLS spoken to plain HTTP; a click or submit that lands on Chrome's error page.
