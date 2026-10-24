import test from 'node:test'
import assert from 'node:assert/strict'
import {captureEnvironment,createEnvironmentUpdateGate} from '../src/environment-lighting.js'

test('environment capture restores renderer and scene after a failed render',()=>{
  const renderer={toneMapping:4},scene={fog:{}},fog=scene.fog,hidden=[{visible:true},{visible:false}],material={envMap:{}},env=material.envMap,radianceUniform={value:0}
  assert.throws(()=>captureEnvironment({renderer,scene,hidden,unlitMaterials:[material],radianceUniform,camera:{update(){
    assert.equal(scene.fog,null); assert.equal(renderer.toneMapping,0); assert.equal(material.envMap,null); assert.equal(radianceUniform.value,1)
    assert.deepEqual(hidden.map(o=>o.visible),[false,false]); throw new Error('GPU failure')
  }}}),/GPU failure/)
  assert.equal(renderer.toneMapping,4); assert.equal(scene.fog,fog); assert.equal(material.envMap,env); assert.equal(radianceUniform.value,0); assert.deepEqual(hidden.map(o=>o.visible),[true,false])
})

test('environment capture throttles video but refreshes a paused source edit',()=>{
  const gate=createEnvironmentUpdateGate(20)
  assert.equal(gate.shouldUpdate(0,1,'clip-a'),true)
  assert.equal(gate.shouldUpdate(16,1.016,'clip-a'),false)
  assert.equal(gate.shouldUpdate(50,1.05,'clip-a'),true)
  assert.equal(gate.shouldUpdate(100,1.05,'clip-a'),false)
  assert.equal(gate.shouldUpdate(101,1.05,'clip-a-yaw-90'),true)
  gate.reset();assert.equal(gate.shouldUpdate(102,1.05,'clip-a-yaw-90'),true)
})
