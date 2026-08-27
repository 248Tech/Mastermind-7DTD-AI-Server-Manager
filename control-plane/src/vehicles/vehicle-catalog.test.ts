import { describeVehicle, grantSucceeded, parseServerToolsVehicleList, teleportSucceeded } from './vehicle-catalog';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(describeVehicle('EntityMotorcycle')?.itemName === 'vehicleMotorcyclePlaceable', 'maps motorcycle names');
assert(describeVehicle('vehicleMinibike')?.key === 'minibike', 'maps minibike');
assert(describeVehicle('4x4 Truck')?.key === 'truck4x4', 'maps 4x4');
assert(describeVehicle('not-a-car') === null, 'rejects unknown names');

const listed = parseServerToolsVehicleList(
  "[SERVERTOOLS] 'vehicleMotorcycle' Id '1842' Owner Id '171' Owner Name 'Pat', located at 'x 10  y 60 z -20'\n" +
  "[SERVERTOOLS] 'vehicleBicycle' Id '1901' Owner Id '188' Owner Name 'Sam', located at 'x 1  y 50 z 2', player 'Pat' is in this vehicle.",
);
assert(listed.length === 2 && listed[0].entityId === 1842 && listed[0].ownerEntityId === 171, 'parses vehicle ids');
assert(listed[1].occupied === true, 'detects occupied vehicle');
assert(teleportSucceeded("[SERVERTOOLS] Teleported entity '1842' to entity '171' located at '10 61 -19'"), 'teleport success');
assert(grantSucceeded('Gave vehicleMotorcyclePlaceable to Steam_76561198000000000'), 'grant success');
assert(grantSucceeded('Player not found') === false, 'grant missing player');

console.log('vehicle catalog tests passed');
