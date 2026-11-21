// Verifies a Syft SBOM is CycloneDX JSON and lists components.
// CLI: node scripts/sbom-check.mjs <sbom.cdx.json>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function checkSbom(sbom) {
  if (sbom?.bomFormat !== 'CycloneDX')
    throw new Error('SBOM is not CycloneDX JSON');
  const count = Array.isArray(sbom.components) ? sbom.components.length : 0;
  if (count === 0) throw new Error('SBOM has no components');
  return count;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sbom = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log(`CycloneDX ${sbom.specVersion}: ${checkSbom(sbom)} components`);
}
