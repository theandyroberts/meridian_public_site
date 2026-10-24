import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js'

// The same Ferrari geometry and orientation used by the Lab, drawn as a
// restrained technical miniature. This renderer has no independent clock.
export function createAttitudeFerrari(canvas,stageBase){
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true})
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2))
  renderer.setSize(220,190,false)
  const scene=new THREE.Scene(),vehicle=new THREE.Group()
  scene.add(vehicle)
  const camera=new THREE.OrthographicCamera(-2.82,2.82,2.44,-2.44,.1,30)
  camera.position.set(-5.72,4.47,6.87);camera.lookAt(0,0,0)
  scene.add(new THREE.HemisphereLight(0xe0e2d1,0x0b100c,2))
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(-4,6,3);scene.add(light)
  let disposed=false
  const geometries=new Set(),materials=new Set(),textures=new Set()
  const draco=new DRACOLoader().setDecoderPath(`${stageBase}/draco/gltf/`)
  const loader=new GLTFLoader().setDRACOLoader(draco)
  const ready=loader.loadAsync(`${stageBase}/models/ferrari.glb`).then(gltf=>{
    const car=gltf.scene.children[0]||gltf.scene
    car.rotation.y=-Math.PI/2;car.updateMatrixWorld(true)
    const bounds=new THREE.Box3().setFromObject(car),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),scale=3.25/Math.max(size.x,size.z)
    car.scale.multiplyScalar(scale);car.position.addScaledVector(center,-scale)
    car.traverse(mesh=>{
      if(!mesh.isMesh)return
      geometries.add(mesh.geometry)
      for(const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material])){
        for(const value of Object.values(material))if(value?.isTexture)textures.add(value)
        material.dispose()
      }
      const body=/body|glass|rim|trim|lights_red/.test(mesh.name)
      // Dark solid depth surface removes the confusing far-side wire clutter.
      mesh.material=new THREE.MeshPhongMaterial({color:body?0x344039:0x1a211c,shininess:30})
      materials.add(mesh.material)
      if(body){
        const geometry=new THREE.EdgesGeometry(mesh.geometry,28),material=new THREE.LineBasicMaterial({color:0xe0decb,transparent:true,opacity:/body|glass/.test(mesh.name)?.78:.38})
        geometries.add(geometry);materials.add(material);mesh.add(new THREE.LineSegments(geometry,material))
      }
    })
    textures.forEach(texture=>texture.dispose());textures.clear()
    if(disposed){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());return}
    vehicle.add(car);renderer.render(scene,camera)
  }).finally(()=>draco.dispose())
  return {ready,setPose(q){if(disposed)return;vehicle.quaternion.fromArray(q);renderer.render(scene,camera)},dispose(){disposed=true;draco.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer.dispose()}}
}
