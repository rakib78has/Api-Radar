export { analyzeRequests, type AnalysisInput, type AnalysisResult } from './analysis/analyze.js';
export { computeEndpointStats, percentile } from './analysis/stats.js';
export { SEVERITY_RANK, duplicateSeverity, minConfidence } from './confidence/classification.js';
export { detectDuplicates } from './detection/duplicates.js';
export { evaluateEndpointRules, type EndpointRuleInput } from './detection/endpoint-rules.js';
export { compareFindings } from './detection/findings.js';
export { detectRequestsAfterNavigation } from './detection/navigation.js';
export { detectExcessivePolling, median, type PollingAnalysis } from './detection/polling.js';
export { isFailure } from './detection/requests.js';
export { detectRetries, type RetryAnalysis } from './detection/retries.js';
export { fnv1a64, hashFields } from './hash.js';
export { fingerprintBody, type BodyFingerprint } from './normalization/body.js';
export { normalizeHttpMethod } from './normalization/http-method.js';
export {
  normalizeNavigation,
  normalizeRequest,
  type NormalizationOptions,
  type NormalizeNavigationResult,
  type NormalizeRequestResult,
  type RequestRejectionReason,
} from './normalization/request.js';
export { normalizeResourceType } from './normalization/resource-type.js';
export {
  REDACTED,
  createSensitiveNameMatcher,
  type SensitiveNameMatcher,
} from './normalization/sensitive.js';
export {
  classifySegment,
  parseRequestUrl,
  type ParsedRequestUrl,
  type SegmentKind,
} from './normalization/url.js';
export {
  compareWithBaseline,
  createBaseline,
  findingKeysOf,
  type BaselineMetadata,
} from './regression/baseline.js';
export {
  compileEndpointRule,
  compileMatcher,
  compilePollingPolicy,
  type CompiledEndpointRule,
  type CompiledPollingPolicy,
  type RequestPredicate,
} from './rules/compiled.js';
export { compileEndpointPattern, wildcardMatch, type PathMatcher } from './rules/pattern.js';
