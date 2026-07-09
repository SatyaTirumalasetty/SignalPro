import '@testing-library/jest-dom/vitest'

// Radix UI primitives (Select, Dialog, Dropdown) rely on APIs jsdom doesn't implement.
if (!window.HTMLElement.prototype.hasPointerCapture) {
  window.HTMLElement.prototype.hasPointerCapture = () => false
}
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}
if (!window.HTMLElement.prototype.releasePointerCapture) {
  window.HTMLElement.prototype.releasePointerCapture = () => {}
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
