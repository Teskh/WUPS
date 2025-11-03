# Editor Subsystem

This directory implements the interactive edit mode that layers on top of the Three.js frame viewer.

Current capabilities:
- Toggleable edit mode with inline HUD messaging and a controls panel.
- Category filters (default: operations only) to limit which elements are selectable.
- Selection outlines (green) and operation previews (red old state, green new state).
- Delete and translate (`G` → axis → magnitude) commands with confirmation / cancel flow.
- Non-destructive persistence that emits `*-modified.wup` copies based on the parsed statement list.

See `docs/editor-design.md` for the roadmap and future enhancements (undo/redo, additional commands, richer overlays).
