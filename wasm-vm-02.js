import assert from 'node:assert';
import test from 'node:test';


import {i32, instrImm, VM} from './wasm-vm-01.js';


class FlatFrame extends VM {
  constructor(instructions, locals = []) {
    super(instructions);
    this.locals = locals;
  }
}


function assertLocalIndexInRange(locals, index) {
  if (index < 0 || index >= locals.length) {
    throw new Error(`Invalid local index: ${index}`);
  }
}


const local = {};
local.get = (index) =>
  instrImm(0x20, 'local.get', index, (vm, index) => {
    assertLocalIndexInRange(vm.locals, index);
    const value = vm.locals[index];
    vm.push(value);
  });


test('local.get', () => {
  const vm = new FlatFrame([local.get(0)], [i32(100)]);
  vm.step();
  assert.deepStrictEqual(vm.stack.items, [i32(100)]);
});


local.set = (index) =>
  instrImm(0x21, 'local.set', index, (vm, index) => {
    assertLocalIndexInRange(vm.locals, index);
    const value = vm.pop();
    vm.locals[index] = value;
  });


test('local.set', () => {
  const vm = new FlatFrame([i32.const(42), local.set(0)], [i32(0)]);
  vm.step();
  vm.step();
  assert.deepStrictEqual(vm.stack.items, []);
  assert.strictEqual(vm.locals[0].value, 42);
});


local.tee = (index) =>
  instrImm(0x22, 'local.tee', index, (vm, index) => {
    assertLocalIndexInRange(vm.locals, index);
    const value = vm.peek();
    vm.locals[index] = value;
  });


test('local.tee', () => {
  const vm = new FlatFrame([i32.const(42), local.tee(0)], [i32(0)]);
  vm.step();
  vm.step();
  assert.strictEqual(vm.locals[0].value, 42);
  assert.deepStrictEqual(vm.stack.items, [i32(42)]);
});


class MonoInstance {
  constructor(instructions, locals = [], globals = []) {
    this.currentFrame = new FlatFrame(instructions, locals);
    this.globals = globals;
  }
  get locals() {
    return this.currentFrame.locals;
  }
  get stack() {
    return this.currentFrame.stack;
  }
  push(value) {
    this.currentFrame.push(value);
  }
  pop() {
    return this.currentFrame.pop();
  }
  peek() {
    return this.currentFrame.peek();
  }
  popI32() {
    return this.currentFrame.popI32();
  }
  popType(T) {
    return this.currentFrame.popType(T);
  }
  step() {
    const {currentFrame} = this;
    const instruction = currentFrame.instructions[currentFrame.pc];
    instruction.eval(this);
    currentFrame.pc += 1;
  }
}


test('local.tee for MonoInstance', () => {
  const vm = new MonoInstance([i32.const(42), local.tee(0)], [i32(0)]);
  vm.step();
  vm.step();
  assert.strictEqual(vm.locals[0].value, 42);
  assert.deepStrictEqual(vm.stack.items, [i32(42)]);
});


function assertGlobalIndexInRange(globals, index) {
  if (index < 0 || index >= globals.length) {
    throw new Error(`Invalid global index: ${index}`);
  }
}


const global = {};
global.get = (index) =>
  instrImm(0x23, 'global.get', index, (vm, index) => {
    assertGlobalIndexInRange(vm.globals, index);
    const value = vm.globals[index];
    vm.push(value);
  });


test('global.get', () => {
  const instance = new MonoInstance([global.get(0)], [], [i32(100)]);
  instance.step();
  assert.strictEqual(instance.peek().value, 100);
});


global.set = (index) =>
  instrImm(0x24, 'global.set', index, (vm, index) => {
    assertGlobalIndexInRange(vm.globals, index);
    const value = vm.pop();
    vm.globals[index] = value;
  });


test('global.set', () => {
  const instance = new MonoInstance(
    [i32.const(42), global.set(0)],
    [],
    [i32(0)],
  );
  instance.step();
  instance.step();
  assert.strictEqual(instance.globals[0].value, 42);
});


export * from './wasm-vm-01.js';
export {local, global};
