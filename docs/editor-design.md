# Editing Mode — Design Plan

Status: Phase 1 complete — selection, delete, translate, HUD, overlays, and save-as-copy are live. Notes below capture future phases and extension ideas.

Scope for first iteration:
- Toggleable editing mode within the existing viewer
- Selection with filtering by element categories (structure, routings, sheathing)
- Two commands: Delete and Translate (G → axis → value)
- Non-destructive save: always `-modified` copy
- Visual overlays: old (red) vs new (green), with optional blue preview
- Confirmation/cancel flow for all edits

## Architecture

- EditorController: orchestrates editor state, selection, commands, overlays, and UI.
- State Machine: Disabled → Idle → (Selecting | CommandPending → AxisPending → NumericInput → Preview → Confirm).
- SelectionManager: tracks selected objects; applies kind/category filters.
- CommandRegistry: registers commands (delete, translate) and produces instances.
- Overlays: draws outlines/ghosts for old/new states using a dedicated overlay group.
- I/O: serializes to new WUP file; never overwrites original.
- UI: edit toggle, selection filters, command triggers; keyboard input helper for G/X|Y|Z/number.

## Directory Layout

- `editor/` — new subsystem root
  - `editor-controller.js` — main orchestrator
  - `state/editor-state.js` — editor modes, allowed kinds/groups
  - `selection/selection-manager.js`, `selection/filters.js`
  - `commands/command-registry.js`, `commands/delete.js`, `commands/move-translate.js`
  - `overlays/overlay-manager.js`, `overlays/outline-materials.js`
  - `ui/edit-controls.js`, `ui/keymap.js`
  - `io/save.js`, `io/wup-serializer.js`
  - `utils/events.js`

## Integration Points

- FrameViewer hooks (implemented):
  - `pickObjectAt(clientX, clientY)` reuses the viewer raycaster.
  - Dedicated overlay group renders editor outlines above the model.
  - `updateModel(model, { maintainCamera })` allows edits without resetting the camera.

- UI wiring:
  - Add an “Edit Mode” toggle and a small panel for filters (structure, routings, sheathing) and actions (Delete, Move/Translate).
  - Numeric input: inline HUD near cursor or a compact input in the controls panel; Enter confirms, Esc cancels.

## Selection & Filtering

- Categories → kinds mapping:
  - structure: stud, blocking, plate
  - routings: paf, nailRow, boy
  - sheathing: sheathing
- Only kinds within enabled categories are selectable; hover still works, but selection cursor highlights only eligible elements.

## Commands

### Delete
- Preview: selected elements outlined in red.
- Confirm: remove from in-memory model; re-render; enable undo via transaction log.

### Translate (G)
- Flow: `G` → axis (`x|y|z`) → magnitude (typed mm) → preview → confirm/cancel.
- Preview overlays: old position outlined red; new position outlined green. Optional blue overlay for transient preview before axis/value are finalized.
- Apply: update element coordinates or placement fields in model (not meshes), then refresh viewer via `updateModel`.

## Keyboard & Confirmation

- Shortcuts: `G` (translate). Axis constrained by `X`, `Y`, `Z` keys; numeric typing for mm; `Enter` apply; `Esc` cancel.
- UI affordance for numeric entry: temporary input or inline HUD.

## Persistence

- Do not overwrite original. Always offer download `originalName-modified.wup`.
- Implement `serializeWup(model)` to write full WUP content; initial MVP can target structures and simple sheathing; expand coverage iteratively.

## Visual Overlays

- Use `EdgesGeometry` lines or polygon offset materials to ensure outlines render on top.
- Colors configurable (defaults): old=red (#ff5252), new=green (#2ecc71), preview=blue (#3498db).

## Phased Rollout

1. Scaffolding + UI skeleton + selection highlight
2. Delete command with confirmation + save-as-modified
3. Translate (G) with axis/value input + previews
4. Undo/redo via transactions; multi-selection; snapping/grid
5. Extended serialization for full WUP feature coverage

## Risks & Notes

- Accurate WUP serialization is non-trivial; plan incremental coverage.
- Keep viewer/editor boundaries clean to avoid regressions in viewing-only mode.
- Consider accessibility for editor UI (keyboard focus, ARIA roles).
