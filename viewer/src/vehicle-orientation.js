import { Group } from 'three'

// Ferrari faces -Z; BMW and Escalade face +Z after authored transforms. The stage and
// named camera views use +X as forward. Rotate a parent so the imported
// up-axis transforms and any additional scene roots remain intact.
export const VEHICLE_FORWARD_YAW = Object.freeze({
  ferrari: -Math.PI / 2,
  bmwM5: Math.PI / 2,
  escalade: Math.PI / 2,
})

export function orientVehicleModel(scene, vehicleKey) {
  const model = new Group()
  model.rotation.y = VEHICLE_FORWARD_YAW[vehicleKey] ?? VEHICLE_FORWARD_YAW.ferrari
  model.add(scene)
  return model
}
