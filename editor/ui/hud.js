// Simple inline HUD displayed over the canvas.

export function createHud() {
  if (typeof document === "undefined") {
    return {
      setMessage: () => {},
      destroy: () => {}
    };
  }

  const root = document.createElement("div");
  root.className = "editor-hud hidden";

  const message = document.createElement("div");
  message.className = "editor-hud__message";
  root.appendChild(message);

  document.body.appendChild(root);

  return {
    setMessage(text) {
      const value = text ?? "";
      message.textContent = value;
      if (!value) {
        root.classList.add("hidden");
      } else {
        root.classList.remove("hidden");
      }
    },
    destroy() {
      if (root.parentNode) {
        root.parentNode.removeChild(root);
      }
    }
  };
}

