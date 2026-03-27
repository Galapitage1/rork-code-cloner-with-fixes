#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const rootPath = path.join(__dirname, '..');
const distPath = path.join(rootPath, 'dist');
const appPath = path.join(rootPath, 'app');
const htaccessSource = path.join(rootPath, '.htaccess');
const htaccessDest = path.join(distPath, '.htaccess');
const distIndex = path.join(distPath, 'index.html');
const websiteStaticSource = path.join(rootPath, 'public', 'website');
const websiteStaticDest = path.join(distPath, 'website');
const trackerWebsiteSource = path.join(rootPath, 'public', 'Tracker', 'website');
const trackerWebsiteDest = path.join(distPath, 'Tracker', 'website');
const trackerWebsiteSettingsSource = path.join(rootPath, 'public', 'Tracker', 'data', 'website_settings.json');
const trackerWebsiteSettingsDest = path.join(distPath, 'Tracker', 'data', 'website_settings.json');
const faviconVersion = '20260302';
const webAssetVersion = String(Date.now());

function walkFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function routeFromAppFile(absFile) {
  const rel = path.relative(appPath, absFile).replace(/\\/g, '/');
  if (!/\.(tsx|ts|jsx|js)$/.test(rel)) return null;

  const noExt = rel.replace(/\.(tsx|ts|jsx|js)$/, '');
  const parts = noExt.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  // Skip Expo special route files.
  if (parts.some((p) => p.startsWith('+'))) return null;
  if (parts[parts.length - 1] === '_layout') return null;
  if (parts.some((p) => p.includes('[') || p.includes(']'))) return null;

  const cleaned = parts.filter((p) => !(p.startsWith('(') && p.endsWith(')')));
  if (cleaned.length === 0) return '/';

  if (cleaned[cleaned.length - 1] === 'index') {
    cleaned.pop();
  }

  if (cleaned.length === 0) return '/';
  return `/${cleaned.join('/')}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(source, destination) {
  if (!fs.existsSync(source)) return false;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    ensureDir(destination);
    const entries = fs.readdirSync(source, { withFileTypes: true });
    for (const entry of entries) {
      copyRecursive(path.join(source, entry.name), path.join(destination, entry.name));
    }
    return true;
  }

  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
  return true;
}

function applyFaviconLinks(html) {
  const faviconLinks = [
    `<link rel="icon" type="image/x-icon" href="/favicon.ico?v=${faviconVersion}" />`,
    `<link rel="shortcut icon" type="image/x-icon" href="/favicon.ico?v=${faviconVersion}" />`,
    `<link rel="apple-touch-icon" href="/favicon.ico?v=${faviconVersion}" />`,
  ].join('');

  // Remove previously generated or Expo-generated icon tags, then inject a consistent set.
  const cleaned = html.replace(/<link[^>]+rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>/gi, '');
  if (cleaned.includes('</head>')) {
    return cleaned.replace('</head>', `${faviconLinks}</head>`);
  }
  return `${cleaned}${faviconLinks}`;
}

function applyWebAssetVersioning(html) {
  return html
    .replace(
      /(<link[^>]+href=")(\/_expo\/static\/css\/[^"?]+)(?:\?[^"]*)?(")/gi,
      (_match, prefix, assetPath, quote) => `${prefix}${assetPath}?v=${webAssetVersion}${quote}`
    )
    .replace(
      /(<script[^>]+src=")(\/_expo\/static\/js\/web\/[^"?]+)(?:\?[^"]*)?(")/gi,
      (_match, prefix, assetPath, quote) => `${prefix}${assetPath}?v=${webAssetVersion}${quote}`
    );
}

if (!fs.existsSync(distPath) || !fs.existsSync(distIndex)) {
  console.error('❌ dist/index.html not found - run expo export first');
  process.exit(1);
}

if (fs.existsSync(htaccessSource)) {
  fs.copyFileSync(htaccessSource, htaccessDest);
  console.log('✅ Copied .htaccess to dist/.htaccess');
} else {
  console.log('⚠️  .htaccess file not found in project root');
}

if (copyRecursive(websiteStaticSource, websiteStaticDest)) {
  console.log('✅ Copied public website manager to dist/website');
} else {
  console.log('⚠️  public/website not found - skipping website manager export');
}

if (copyRecursive(trackerWebsiteSource, trackerWebsiteDest)) {
  console.log('✅ Copied Tracker website manager to dist/Tracker/website');
} else {
  console.log('⚠️  public/Tracker/website not found - skipping Tracker website manager export');
}

if (copyRecursive(trackerWebsiteSettingsSource, trackerWebsiteSettingsDest)) {
  console.log('✅ Copied Tracker website settings seed to dist/Tracker/data/website_settings.json');
} else {
  console.log('⚠️  public/Tracker/data/website_settings.json not found - skipping seed export');
}

if (!fs.existsSync(appPath)) {
  console.log('⚠️  app folder not found - skipping route fallbacks');
  process.exit(0);
}

const routeFiles = walkFiles(appPath);
const routes = new Set(['/']);
for (const file of routeFiles) {
  const route = routeFromAppFile(file);
  if (route) routes.add(route);
}

const rawIndexHtml = fs.readFileSync(distIndex, 'utf8');
const indexHtml = applyWebAssetVersioning(applyFaviconLinks(rawIndexHtml));
fs.writeFileSync(distIndex, indexHtml, 'utf8');

let created = 0;
for (const route of routes) {
  if (route === '/') continue;
  const routeDir = path.join(distPath, route.slice(1));
  const routeIndex = path.join(routeDir, 'index.html');
  ensureDir(routeDir);
  fs.writeFileSync(routeIndex, indexHtml, 'utf8');
  created += 1;
}

console.log(`✅ Generated ${created} route fallback files for hard-refresh support`);
