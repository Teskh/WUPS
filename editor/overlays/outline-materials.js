// Overlay color configuration (scaffold). Keep configurable for user preference.

export const OverlayColors = Object.freeze({
  old: 0xff5252,     // red outline for old state
  preview: 0x3498db, // blue for transient preview
  new: 0x2ecc71      // green outline for confirmed pending state before apply
});

export const OverlayZBias = Object.freeze({
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -1
});

