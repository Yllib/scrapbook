#!/bin/bash
cat <<'CSS' > apps/web/src/App.css
.app-root {
  position: relative;
  width: 100%;
  height: 100vh;
  background: #020617;
  color: #e2e8f0;
  overflow: hidden;
}

.stage-host {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #020617;
}

.stage-host canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.scene-toolbar {
  position: absolute;
  top: 16px;
  left: 16px;
  display: flex;
  gap: 12px;
  align-items: stretch;
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.9);
  box-shadow: 0 12px 30px rgba(2, 6, 23, 0.45);
  font-size: 14px;
  backdrop-filter: blur(6px);
}

CSS
