import '../shared/zod-config.js';

import { SessionRepository, SettingsRepository } from '@api-qa/storage';

import { chromeStore } from '../shared/chrome-store.js';
import { isTrustedSender } from '../shared/messages.js';
import { matchPatternFor } from '../shared/origins.js';
import { CaptureController } from './capture-controller.js';
import { handleMessage } from './message-handler.js';

const local = chromeStore(chrome.storage.local);
const sessions = new SessionRepository(local);
const settings = new SettingsRepository(local);

const controller = new CaptureController({
  sessions,
  settings,
  state: chromeStore(chrome.storage.session),
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
  hasHostPermission: (origins) =>
    chrome.permissions.contains({ origins: origins.map(matchPatternFor) }),
  schedule: (callback, delayMs) => {
    setTimeout(callback, delayMs);
  },
});

// Listeners are registered synchronously at the top level so that an event
// which wakes a suspended worker is delivered. Events only arrive for hosts
// the user granted, and the controller ignores everything outside the
// captured tab and origins.
const filter: chrome.webRequest.RequestFilter = { urls: ['http://*/*', 'https://*/*'] };

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    void controller.onBeforeRequest(details);
    return undefined;
  },
  filter,
  ['requestBody'],
);
chrome.webRequest.onBeforeRedirect.addListener(
  (details) => void controller.onRedirect(details),
  filter,
);
chrome.webRequest.onCompleted.addListener(
  (details) => void controller.onCompleted(details),
  filter,
);
chrome.webRequest.onErrorOccurred.addListener(
  (details) => void controller.onError(details),
  filter,
);
chrome.webNavigation.onCommitted.addListener((details) => void controller.onNavigation(details));
chrome.tabs.onRemoved.addListener((tabId) => void controller.onTabRemoved(tabId));

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isTrustedSender(sender, chrome.runtime.id, chrome.runtime.getURL(''))) {
    return false;
  }
  void handleMessage(message, { controller, sessions, settings }).then(sendResponse);
  return true;
});
