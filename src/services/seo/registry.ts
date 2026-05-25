import type { SensorModule } from './sensors/types';

export { type SensorModule } from './sensors/types';

export const sensorRegistry: SensorModule[] = [];

export function registerSensor(sensor: SensorModule): void {
  sensorRegistry.push(sensor);
}
