import type { KeyValueStore } from '@api-qa/storage';

/** Adapts a chrome.storage area to the repositories' key-value interface. */
export function chromeStore(area: chrome.storage.StorageArea): KeyValueStore {
  return {
    get: (keys) => area.get([...keys]),
    set: (items) => area.set({ ...items }),
    remove: (keys) => area.remove([...keys]),
  };
}
