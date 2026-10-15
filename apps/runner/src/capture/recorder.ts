import type { CDPSession, Page } from '@playwright/test';

import { CdpAssembler, type CapturedEvents } from './cdp-assembler.js';

/**
 * Records one page's network traffic through the Chrome DevTools Protocol.
 * Chromium only: CDP is what provides the issuing document (loaderId) for
 * every request, which Playwright's request events do not expose.
 */
export class NetworkRecorder {
  readonly #session: CDPSession;
  readonly #assembler: CdpAssembler;

  private constructor(session: CDPSession, assembler: CdpAssembler) {
    this.#session = session;
    this.#assembler = assembler;
  }

  static async attach(page: Page, tabId = 1): Promise<NetworkRecorder> {
    const session = await page.context().newCDPSession(page);
    const assembler = new CdpAssembler(tabId, () => Date.now());
    session.on('Network.requestWillBeSent', (event) => {
      assembler.onRequestWillBeSent(event);
    });
    session.on('Network.responseReceived', (event) => {
      assembler.onResponseReceived(event);
    });
    session.on('Network.loadingFinished', (event) => {
      assembler.onLoadingFinished(event);
    });
    session.on('Network.loadingFailed', (event) => {
      assembler.onLoadingFailed(event);
    });
    session.on('Page.frameNavigated', (event) => {
      assembler.onFrameNavigated(event);
    });
    session.on('Page.navigatedWithinDocument', (event) => {
      assembler.onNavigatedWithinDocument(event);
    });
    await session.send('Network.enable');
    await session.send('Page.enable');
    return new NetworkRecorder(session, assembler);
  }

  get capturing(): boolean {
    return this.#assembler.capturing;
  }

  start(): void {
    this.#assembler.start();
  }

  /**
   * Stops recording and detaches. A page's fetch can resolve before CDP
   * delivers the matching loadingFinished event, so this first waits up to
   * `settleMs` for in-flight requests to finish; any still running after
   * that are recorded as unfinished.
   */
  async stop(settleMs = 2_000): Promise<CapturedEvents> {
    const deadline = Date.now() + settleMs;
    // Always yield once so events already queued are delivered.
    do {
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (this.#assembler.pendingCount > 0 && Date.now() < deadline);
    const events = this.#assembler.stop();
    await this.#session.detach().catch(() => undefined);
    return events;
  }
}
