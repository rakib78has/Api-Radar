import { z } from 'zod';

// Zod 4 compiles parsers with `new Function` when it can. The extension CSP
// forbids that (no 'unsafe-eval'), so turn the JIT off explicitly instead of
// relying on Zod's fallback. Imported first by every entry point.
z.config({ jitless: true });
