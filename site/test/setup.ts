import '@testing-library/jest-dom/vitest';

// jsdom não implementa ResizeObserver — cmdk e base-ui o usam para
// medir popovers. Polyfill mínimo o suficiente para os componentes
// montarem sem explodir nos testes.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    disconnect() {}
    observe() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom não implementa scrollIntoView; cmdk chama nele ao abrir o
// menu. No-op é suficiente para os asserts de DOM.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
