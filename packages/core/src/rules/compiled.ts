import type {
  CapturedRequest,
  EndpointMatcher,
  EndpointRule,
  PollingPolicy,
} from '@api-qa/contracts';

import { compileEndpointPattern } from './pattern.js';

export type RequestPredicate = (request: CapturedRequest) => boolean;

export function compileMatcher(matcher: EndpointMatcher): RequestPredicate {
  const matchesPath = compileEndpointPattern(matcher.path);
  return (request) =>
    (matcher.method === '*' || matcher.method === request.method) &&
    matchesPath(request.origin, request.path);
}

export interface CompiledEndpointRule {
  readonly rule: EndpointRule;
  readonly matches: RequestPredicate;
}

export interface CompiledPollingPolicy {
  readonly policy: PollingPolicy;
  readonly matches: RequestPredicate;
}

export function compileEndpointRule(rule: EndpointRule): CompiledEndpointRule {
  return { rule, matches: compileMatcher(rule.match) };
}

export function compilePollingPolicy(policy: PollingPolicy): CompiledPollingPolicy {
  return { policy, matches: compileMatcher(policy.match) };
}

/** `METHOD path` as written in the rule, for titles and evidence. */
export function describeMatcher(matcher: EndpointMatcher): string {
  return `${matcher.method === '*' ? 'ANY' : matcher.method} ${matcher.path}`;
}
