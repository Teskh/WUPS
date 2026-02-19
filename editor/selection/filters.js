// Selection filters (scaffold).
// Encodes mapping between element kinds and UI categories.

const KindToGroup = Object.freeze({
  stud: "structure",
  blocking: "structure",
  plate: "structure",
  sheathing: "sheathing",
  nailRow: "routings",
  paf: "routings",
  boy: "routings"
});

export function buildFilters() {
  return {
    matches(object, allowedGroups) {
      const kind = object?.userData?.kind;
      const group = KindToGroup[kind];
      if (!group) return false;
      return allowedGroups.has(group);
    }
  };
}

