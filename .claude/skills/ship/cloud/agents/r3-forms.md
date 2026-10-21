<!-- AREA -->
**Forms, shadow DOM and iframes.** `dom form` describes a page's forms, `dom fill` and `dom submit` fill and send them, and `dom query`, `dom get`, `dom inspect`, `dom a11y` read elements, also inside shadow roots and frames. Make bdg report a field value, label, required/valid state or form that isn't the truth; fill a field and claim success while the value the app sees is different; find or miss an element in a shadow root or iframe wrongly; or describe the wrong form.
<!-- TARGETS -->
- **Framework-controlled inputs**: a React-style controlled input that resets its value on the next render, an input that formats as you type (masks, thousands separators), one that rejects some characters, a contenteditable "input", a custom element with a form-associated internal input (`ElementInternals`).
- **Values bdg reads vs what the app sees**: `value` property vs `value` attribute, a `<select>` with duplicate option labels, a checkbox whose `checked` is changed by script after the fill, a radio group across shadow roots, a hidden input that mirrors a visible one.
- **Labels and names**: a label `for=` pointing to a duplicate id, `aria-labelledby` across a shadow boundary, a placeholder pretending to be a label, two forms with identical fields on one page.
- **Validity**: `required` set by script, `setCustomValidity`, a `pattern`, a `novalidate` form, validation that only runs on blur.
- **Shadow DOM**: open and closed roots, nested roots, slots that project light-DOM inputs, the same selector matching in light DOM and in a shadow root.
- **Iframes**: same-origin and cross-origin (two local ports), `srcdoc`, an iframe that navigates after load, a sandboxed iframe, a form inside an iframe inside a shadow root.
- **Submit**: a form whose submit handler calls `preventDefault` and does nothing, one that submits via fetch and shows an error, one with two submit buttons with different `formaction`.
<!-- COVERED -->
secrets typed into password, card or token fields leaking into output; a form in a shadow root filled with labels; a closed shadow root; a fill that appends to an existing value on a Telerik-style widget; a value that doesn't match after a fill (exit 90); forms named after the page heading (known, open).
