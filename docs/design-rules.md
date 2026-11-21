# Design rules

Rules every change to the widget and the lab pages follows. Check them before a PR.

## Corners are concentric

A rounded box inside another rounded box takes the outer radius minus the gap between them, so both curves share one centre:

```css
inner { border-radius: max(0px, calc(var(--_radius) - <gap>)); }
```

- Write it from the token (`--_radius`, `--_card-r`), never a fixed number, so it stays right when `--lab-radius` or the squircle radius changes.
- No inline `border-radius` from script on a box whose children follow it: the stylesheet owns the outer corner.
- A circle (send, dots) stays a circle.

(Leo, 18 Nov: "rounded corners inside and outside different", then "make it as rule for us".)

## Two corner sizes

A corner is the small token (`--_r-s`, 6 px) or the box token (`--_radius`, 12 px; squircle 11 and 21.6), a circle (`50%`) or the pin's teardrop. Parts drawn in the board's own shadow root get the same two names from its `:host`, with the same squircle step, so the board follows `--lab-radius` too.

- Not `999px` for a button (the box token is already fully round at a button's height), and not 6, 8 or 12 typed by hand.
- Thin bars (scrollbar thumb, grab handle, the highlight line) are half their height and stay as they are.

(Leo, 21 Nov: "open new lab with applied system … to the labit itself".)
