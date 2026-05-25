import { registerSensor } from '../registry';

import { lifecycleController } from './lifecycle-controller';
import { infogainChecker } from './infogain-checker';
import { costGuard } from './cost-guard';
import { eeatScorer } from './eeat-scorer';
import { semanticLinker } from './semantic-linker';
import { cannibalDetector } from './cannibal-detector';

registerSensor(lifecycleController);
registerSensor(infogainChecker);
registerSensor(costGuard);
registerSensor(eeatScorer);
registerSensor(semanticLinker);
registerSensor(cannibalDetector);
