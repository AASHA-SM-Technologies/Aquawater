import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;

console.log('=== AquaPure Image Validation Audit ===\n');

// 1. Scan source code in index.html
const indexPath = path.join(rootDir, 'index.html');
const indexContent = fs.readFileSync(indexPath, 'utf-8');

// Known expected image names from analysis:
// From P: prod-pro, prod-prime, prod-flow, prod-comm
// From GAL: gal-pro, splash, prod-prime, kitchen-glass, gal-lab, gal-family, prod-flow, benefits-glass, gal-kitchen, woman-drinking
// Direct references: hero-purifier, expert, building, kitchen-glass, benefits-glass, woman-drinking
const imageSet = new Set();

// Extract from heroimg and any src="/assets/..." or src="assets/..."
const staticMatches = indexContent.matchAll(/(?:\/)?assets\/([a-zA-Z0-9_-]+)\.jpg/g);
for (const m of staticMatches) {
  imageSet.add(m[1] + '.jpg');
}

// Extract from GAL
const galMatch = indexContent.match(/var GAL=\[([\s\S]*?)\];/);
if (galMatch) {
  const items = galMatch[1].matchAll(/\['([^']+)',\s*'([^']+)',\s*'([^']+)'\]/g);
  for (const item of items) {
    imageSet.add(item[3] + '.jpg');
  }
}

// Extract from P
const pMatch = indexContent.match(/var P=\[([\s\S]*?)\];/);
if (pMatch) {
  const items = pMatch[1].matchAll(/id:'([^']+)'/g);
  for (const item of items) {
    imageSet.add(`prod-${item[1]}.jpg`);
  }
}

// Extract from cta(..., 'img')
const ctaMatches = indexContent.matchAll(/cta\([^)]*,\s*['"]([a-zA-Z0-9_-]+)['"]\s*\)/g);
for (const m of ctaMatches) {
  imageSet.add(m[1] + '.jpg');
}

// Extract from A('...', ...) literal calls (excluding partial prefixes like 'prod-')
const aMatches = indexContent.matchAll(/A\(['"]([a-zA-Z0-9_-]+)['"](?:\s*,|\s*\))/g);
for (const m of aMatches) {
  if (m[1] !== 'prod-') {
    imageSet.add(m[1] + '.jpg');
  }
}

const referencedImages = Array.from(imageSet).sort();
console.log(`Found ${referencedImages.length} unique referenced image assets in index.html:`);
referencedImages.forEach(img => console.log(`  - ${img}`));

// 2. Check existence in public/assets and assets/
const checkDirs = [
  { name: 'public/assets', dir: path.join(rootDir, 'public', 'assets') },
  { name: 'assets', dir: path.join(rootDir, 'assets') }
];

let hasErrors = false;

for (const { name, dir } of checkDirs) {
  console.log(`\nChecking directory: ${name}/`);
  if (!fs.existsSync(dir)) {
    console.error(`  [FAIL] Directory ${dir} does not exist!`);
    hasErrors = true;
    continue;
  }

  const diskFiles = fs.readdirSync(dir);
  const diskFileSet = new Set(diskFiles);

  for (const img of referencedImages) {
    if (!diskFileSet.has(img)) {
      // Check for case mismatch
      const lower = img.toLowerCase();
      const caseMatch = diskFiles.find(f => f.toLowerCase() === lower);
      if (caseMatch) {
        console.error(`  [FAIL] Case mismatch: Referenced "${img}", but file on disk is "${caseMatch}"`);
      } else {
        console.error(`  [FAIL] Missing image: "${img}" not found in ${name}/`);
      }
      hasErrors = true;
    } else {
      const stats = fs.statSync(path.join(dir, img));
      if (stats.size === 0) {
        console.error(`  [FAIL] Zero-byte image: "${img}" in ${name}/`);
        hasErrors = true;
      } else {
        console.log(`  [OK] ${img} (${stats.size} bytes)`);
      }
    }
  }
}

// 3. Test build
console.log('\nRunning production build (npm run build)...');
try {
  execSync('npm run build', { cwd: rootDir, stdio: 'pipe' });
  console.log('  [OK] Build succeeded.');
} catch (err) {
  console.error('  [FAIL] Build failed:', err.message);
  process.exit(1);
}

// 4. Verify production dist/ output
console.log('\nVerifying production build output in dist/assets/...');
const distAssetsDir = path.join(rootDir, 'dist', 'assets');
if (!fs.existsSync(distAssetsDir)) {
  console.error('  [FAIL] dist/assets/ does not exist after build!');
  hasErrors = true;
} else {
  const distFiles = fs.readdirSync(distAssetsDir);
  const distFileSet = new Set(distFiles);
  for (const img of referencedImages) {
    if (!distFileSet.has(img)) {
      console.error(`  [FAIL] Missing in dist/assets/: ${img}`);
      hasErrors = true;
    } else {
      const stats = fs.statSync(path.join(distAssetsDir, img));
      console.log(`  [OK] dist/assets/${img} (${stats.size} bytes)`);
    }
  }
}

console.log('\n=== Summary ===');
if (hasErrors) {
  console.error('FAILED: One or more image validation checks failed.');
  process.exit(1);
} else {
  console.log(`SUCCESS: All ${referencedImages.length} images exist, paths match exactly, and are verified in production build!`);
}
