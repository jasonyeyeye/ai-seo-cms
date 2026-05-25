import '../services/seo/sensors/index';
import { sensorRegistry } from '../services/seo/registry';

async function main() {
  console.log(`[Sensors] Running ${sensorRegistry.length} sensor modules...`);

  for (const sensor of sensorRegistry) {
    if (!sensor.enabled) {
      console.log(`[Sensors] Skipping disabled sensor: ${sensor.name}`);
      continue;
    }

    console.log(`[Sensors] Executing: ${sensor.name} (${sensor.source})`);
    try {
      const results = await sensor.execute();
      console.log(`[Sensors] ${sensor.name} produced ${results.length} suggestions.`);
    } catch (error) {
      console.error(`[Sensors] ${sensor.name} failed:`, error);
    }
  }

  console.log('[Sensors] All done.');
}

main();
