import { z } from 'zod';

/** The only API permissions the extension may request. */
export const REQUIRED_PERMISSIONS = ['activeTab', 'storage', 'webNavigation', 'webRequest'];
/** Host access is optional and granted per origin when a capture starts. */
export const OPTIONAL_HOST_PERMISSIONS = ['http://*/*', 'https://*/*'];

/**
 * The complete manifest shape this project ships. Any other top-level key
 * (content scripts, web-accessible resources, externally_connectable, ...)
 * is reported as a violation.
 */
const manifestSchema = z.object({
  manifest_version: z.literal(3),
  name: z.string().min(1).max(45),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Chrome versions are dot-separated integers'),
  description: z.string().min(1).max(132),
  minimum_chrome_version: z.string().regex(/^\d+$/),
  action: z.strictObject({
    default_title: z.string().min(1),
    default_popup: z.string().min(1),
    default_icon: z.record(z.string(), z.string()).optional(),
  }),
  background: z.strictObject({
    service_worker: z.string().min(1),
    type: z.literal('module'),
  }),
  permissions: z.array(z.string()),
  optional_host_permissions: z.array(z.string()),
  host_permissions: z.array(z.string()).optional(),
  content_security_policy: z.strictObject({ extension_pages: z.string() }),
  icons: z.record(z.string(), z.string()).optional(),
});

export interface ManifestPolicyOptions {
  /** Version the manifest must carry (from package.json). */
  readonly expectedVersion: string;
  /** Files present in the build output, as forward-slash relative paths. */
  readonly files: ReadonlySet<string>;
  /** Host permissions allowed outright; only the E2E build sets these. */
  readonly allowedHostPermissions?: readonly string[];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
}

function directive(policy: string, name: string): string[] | null {
  for (const part of policy.split(';')) {
    const [directiveName, ...sources] = part.trim().split(/\s+/);
    if (directiveName === name) {
      return sources;
    }
  }
  return null;
}

/** Returns every policy violation; an empty list means the manifest is acceptable. */
export function validateManifest(input: unknown, options: ManifestPolicyOptions): string[] {
  const unknownKeys =
    typeof input === 'object' && input !== null
      ? Object.keys(input).filter((key) => !(key in manifestSchema.shape))
      : [];
  const unknownIssues = unknownKeys.map(
    (key) => `${key} is not allowed in this extension's manifest`,
  );
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    return [
      ...unknownIssues,
      ...parsed.error.issues.map(
        (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
      ),
    ];
  }
  const manifest = parsed.data;
  const issues: string[] = [...unknownIssues];

  if (manifest.version !== options.expectedVersion) {
    issues.push(`version is ${manifest.version}, but package.json says ${options.expectedVersion}`);
  }
  if (!sameSet(manifest.permissions, REQUIRED_PERMISSIONS)) {
    issues.push(`permissions must be exactly ${REQUIRED_PERMISSIONS.join(', ')}`);
  }
  if (!sameSet(manifest.optional_host_permissions, OPTIONAL_HOST_PERMISSIONS)) {
    issues.push(
      `optional_host_permissions must be exactly ${OPTIONAL_HOST_PERMISSIONS.join(', ')}`,
    );
  }
  const allowedHosts = options.allowedHostPermissions ?? [];
  const hosts = manifest.host_permissions ?? [];
  if (!sameSet(hosts, allowedHosts)) {
    issues.push(
      allowedHosts.length === 0
        ? 'host_permissions must not be declared; host access is requested at runtime'
        : `host_permissions must be exactly ${allowedHosts.join(', ')}`,
    );
  }
  if (
    hosts.some((host) => host === '<all_urls>' || host.startsWith('*://') || host.includes('://*/'))
  ) {
    issues.push('host_permissions must not grant access to every site');
  }

  const policy = manifest.content_security_policy.extension_pages;
  const scriptSources = directive(policy, 'script-src');
  if (scriptSources === null || !sameSet(scriptSources, ["'self'"])) {
    issues.push(
      "content_security_policy.extension_pages must set script-src 'self' and nothing else",
    );
  }
  const objectSources = directive(policy, 'object-src');
  if (objectSources === null || !sameSet(objectSources, ["'none'"])) {
    issues.push("content_security_policy.extension_pages must set object-src 'none'");
  }
  if (/unsafe-eval|unsafe-inline|https?:|\*/.test(policy)) {
    issues.push('content_security_policy must not allow eval, inline scripts or remote sources');
  }

  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action.default_icon ?? {}),
  ];
  for (const file of referenced) {
    if (!options.files.has(file)) {
      issues.push(`${file} is referenced by the manifest but missing from the build`);
    }
  }
  return issues;
}

/** Remote code is not allowed in Manifest V3: no script or import may load from the network. */
export function findRemoteCode(fileName: string, content: string): string[] {
  const issues: string[] = [];
  if (fileName.endsWith('.html') && /<script[^>]+src=["']?(?:https?:)?\/\//i.test(content)) {
    issues.push(`${fileName} loads a script from the network`);
  }
  if (fileName.endsWith('.js')) {
    if (/\bimport\s*\(\s*["'`]https?:/.test(content) || /\bfrom\s*["']https?:/.test(content)) {
      issues.push(`${fileName} imports a module from the network`);
    }
    if (/\bimportScripts\s*\(/.test(content)) {
      issues.push(`${fileName} calls importScripts`);
    }
  }
  return issues;
}
