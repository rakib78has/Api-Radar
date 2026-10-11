/**
 * The WHATWG URL API exists in every runtime core targets (Chrome extension
 * contexts, web pages and Node.js 24). Core compiles without the DOM and
 * Node.js type libraries so that every other browser and Node.js API stays
 * unavailable to it; only the URL members core reads are declared here.
 */
declare class URL {
  constructor(url: string, base?: string);
  readonly protocol: string;
  readonly origin: string;
  readonly pathname: string;
  readonly search: string;
}
