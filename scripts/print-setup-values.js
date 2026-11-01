#!/usr/bin/env node
/* Prints the exact values to paste into Supabase / Google for YOUR project. Invents nothing:
 *   SUPABASE_URL=https://<ref>.supabase.co SITE_URL=https://your-domain node scripts/print-setup-values.js */
const url = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), site = (process.env.SITE_URL || '').replace(/\/$/, '');
const m = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.(co|in)$/i);
if (!m) { console.error('Set SUPABASE_URL to https://<project-ref>.supabase.co'); process.exit(1); }
console.log('Supabase project ref        : ' + m[1]);
console.log('Google "Authorized redirect URI" (exact):\n  ' + url + '/auth/v1/callback');
console.log('Google "Authorized JavaScript origins":\n  ' + (site || '<your site origin, e.g. https://stash.example.com>') + '\n  http://localhost:8000   (local dev only, in a DEV Google client)');
console.log('Supabase > Authentication > URL Configuration:\n  Site URL: ' + (site || '<your production origin>') + '\n  Redirect URLs:\n    ' + (site ? site + '/**' : '<your production origin>/**') + '\n    http://localhost:8000/**\n    <your Vercel preview pattern, from the Vercel dashboard>');
