export function clearGroup(group) {
  for (let i = group.children.length - 1; i >= 0; i -= 1) {
    const child = group.children[i];
    if (!child.isInstancedMesh && child.geometry) {
      child.geometry.dispose();
    }
    group.remove(child);
  }
}
