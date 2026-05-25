import { EntityService } from '../services/entity/service';

async function main() {
  const args = Bun.argv;
  const scriptPath = args[0];
  const seedKeyword = args[2];

  if (!seedKeyword) {
    console.error('Usage: bun run src/scripts/entity-discovery.ts "<seed keyword>"');
    console.error('Example: bun run src/scripts/entity-discovery.ts "mechanical keyboards"');
    process.exit(1);
  }

  console.log(`[Entity Discovery] Starting with seed keyword: "${seedKeyword}"`);
  console.log('---');

  const result = await EntityService.discoverEntities(seedKeyword);

  console.log('---');
  console.log('[Entity Discovery] Complete!');
  console.log(`  New entities discovered: ${result.discovered}`);
  console.log(`  Existing entities skipped: ${result.skipped}`);
  console.log(`  Relations created: ${result.relationsCreated}`);
  console.log(`  Attributes enriched: ${result.attributesEnriched}`);

  if (result.discovered > 0) {
    console.log('\n[Entity Discovery] New entities are ready for use.');
  }
}

main().catch((error) => {
  console.error('[Entity Discovery] Fatal error:', error);
  process.exit(1);
});