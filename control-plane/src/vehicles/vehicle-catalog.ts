export type VehicleSpec = {
  key: string;
  itemName: string;
  label: string;
};

const VEHICLES: Array<VehicleSpec & { aliases: string[] }> = [
  { key: 'bicycle', itemName: 'vehicleBicyclePlaceable', label: 'Bicycle', aliases: ['vehiclebicycle', 'vehiclebicycleplaceable', 'bicycle', 'entitybicycle'] },
  { key: 'minibike', itemName: 'vehicleMinibikePlaceable', label: 'Minibike', aliases: ['vehicleminibike', 'vehicleminibikeplaceable', 'minibike', 'entityminibike'] },
  { key: 'motorcycle', itemName: 'vehicleMotorcyclePlaceable', label: 'Motorcycle', aliases: ['vehiclemotorcycle', 'vehiclemotorcycleplaceable', 'motorcycle', 'entitymotorcycle'] },
  { key: 'truck4x4', itemName: 'vehicleTruck4x4Placeable', label: '4x4 Truck', aliases: ['vehicletruck4x4', 'vehicletruck4x4placeable', 'truck4x4', '4x4', '4x4truck', 'truck', 'entitytruck'] },
  { key: 'gyrocopter', itemName: 'vehicleGyrocopterPlaceable', label: 'Gyrocopter', aliases: ['vehiclegyrocopter', 'vehiclegyrocopterplaceable', 'gyrocopter', 'gyro', 'entitygyrocopter'] },
  { key: 'helicopter', itemName: 'vehicleHelicopterPlaceable', label: 'Helicopter', aliases: ['vehiclehelicopter', 'vehiclehelicopterplaceable', 'helicopter'] },
];

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function describeVehicle(raw: string | null | undefined): VehicleSpec | null {
  const key = compact(raw || '');
  if (!key) return null;
  for (const vehicle of VEHICLES) {
    if (vehicle.key === key || compact(vehicle.itemName) === key || vehicle.aliases.includes(key)) return vehicle;
    if (key.includes(vehicle.key) && key.startsWith('vehicle')) return vehicle;
  }
  return null;
}

export function vehicleKeyFromName(raw: string | null | undefined): string | null {
  return describeVehicle(raw)?.key ?? null;
}

export type ListedVehicle = {
  type: string;
  entityId: number;
  ownerEntityId: number;
  occupied: boolean;
};

export function parseServerToolsVehicleList(output: string): ListedVehicle[] {
  const rows: ListedVehicle[] = [];
  const pattern = /'([^']+)'\s+Id\s+'(\d+)'\s+Owner Id\s+'(\d+)'/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output))) {
    const entityId = Number(match[2]);
    const ownerEntityId = Number(match[3]);
    if (!Number.isInteger(entityId) || entityId < 1 || !Number.isInteger(ownerEntityId)) continue;
    rows.push({
      type: match[1].trim(),
      entityId,
      ownerEntityId,
      occupied: /is in this vehicle/i.test(output.slice(match.index, match.index + 280)),
    });
  }
  return rows;
}

export function teleportSucceeded(output: string): boolean {
  const text = output.toLowerCase();
  return text.includes('teleported entity') || text.includes('teleported');
}

export function grantSucceeded(output: string): boolean {
  const text = output.toLowerCase();
  if (!text.trim()) return true;
  if (text.includes('gave') || text.includes('added') || text.includes('gave item')) return true;
  if (text.includes('player not found') || text.includes('item not found') || text.includes('unknown command')) return false;
  return !text.includes('failed');
}
