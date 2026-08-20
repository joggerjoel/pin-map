import "@testing-library/jest-dom/vitest";

// Ensure localStorage is available in jsdom
if (!window.localStorage) {
  const store: Record<string, string> = {};
  window.localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach((key) => {
        delete store[key];
      });
    },
    key: (index: number) => {
      const keys = Object.keys(store);
      return keys[index] || null;
    },
    length: 0,
  } as any;
}
