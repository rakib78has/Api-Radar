/**
 * Host permission granted up front in the E2E build only. Automated browsers
 * cannot click Chrome's permission prompt, so the test build pre-grants the
 * local test server; the production build never declares host_permissions.
 */
export const E2E_HOST_PERMISSIONS = ['http://127.0.0.1/*'];
