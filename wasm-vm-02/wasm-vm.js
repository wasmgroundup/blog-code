import assert from 'node:assert';
import test from 'node:test';


import {I32, drop, i32, instr, nop, Stack, VM} from './wasm-vm-01.js';



class VMLocals extends VM {
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
  instr(
    0x20,
    'local.get',
    (vm) => {
      assertLocalIndexInRange(vm.locals, index);
      const value = vm.locals[index];
      vm.push(value);
    },
    index,
  );


test('local.get', () => {
  const vm = new VMLocals([local.get(0)], [i32(100)]);
  vm.step();
  assert.deepStrictEqual(vm.stack.items, [i32(100)]);
});


local.set = (index) =>
  instr(
    0x21,
    'local.set',
    (vm) => {
      assertLocalIndexInRange(vm.locals, index);
      const value = vm.pop();
      vm.locals[index] = value;
    },
    index,
  );


test('local.set', () => {
  const vm = new VMLocals([i32.const(42), local.set(0)], [i32(0)]);
  vm.step();
  vm.step();
  assert.deepStrictEqual(vm.stack.items, []);
  assert.strictEqual(vm.locals[0].value, 42);
});


local.tee = (index) =>
  instr(
    0x22,
    'local.tee',
    (vm) => {
      assertLocalIndexInRange(vm.locals, index);
      const value = vm.peek();
      vm.locals[index] = value;
    },
    index,
  );


test('local.tee', () => {
  const vm = new VMLocals([i32.const(42), local.tee(0)], [i32(0)]);
  vm.step();
  vm.step();
  assert.strictEqual(vm.locals[0].value, 42);
  assert.deepStrictEqual(vm.stack.items, [i32(42)]);
});


class BlockFrame extends Stack {
  constructor(type = [[], []], breakTargetPc = 0) {
    super();
    // https://www.w3.org/TR/2019/REC-wasm-core-1-20191205/#binary-blocktype
    this.type = type;
    this.breakTargetPc = breakTargetPc;
  }
}


class CallFrame {
  constructor(instructions, locals = [], rootBlockType = []) {
    // TODO: check name
    this.blocks = [];
    this.pushFrame(new BlockFrame(rootBlockType, instructions.length - 1));
    this.instructions = instructions;
    this.locals = locals;
    this.pc = 0;
  }
  get currentBlock() {
    return this.blocks.at(-1);
  }
  pushFrame(frame) {
    this.blocks.push(frame);
  }
  popFrame() {
    return this.blocks.pop();
  }
  findMatchingEndPc() {
    let remainingBlocks = 1;
    let pc = this.pc;
    while (remainingBlocks > 0) {
      pc += 1;
      const {name} = this.instructions[pc];
      if (name === 'end') {
        remainingBlocks -= 1;
      } else if (name === 'block' || name === 'loop' || name === 'if') {
        remainingBlocks += 1;
      }
    }
    return pc;
  }
  findMatchingElsePc() {
    let remainingBlocks = 1;
    let pc = this.pc;
    while (remainingBlocks > 0) {
      pc += 1;
      const {name} = this.instructions[pc];
      if (name === 'else') {
        remainingBlocks -= 1;
      } else if (name === 'if') {
        remainingBlocks += 1;
      }
    }
    return pc;
  }
  breakToLabel(labelidx) {
    let blockFrame = this.popFrame();
    let blocksToPop = labelidx;
    while (blocksToPop > 0) {
      blockFrame = this.popFrame();
      blocksToPop -= 1;
    }
    this.pc = blockFrame.breakTargetPc;
  }
  push(value) {
    this.currentBlock.push(value);
  }
  pop() {
    return this.currentBlock.pop();
  }
  peek() {
    return this.currentBlock.peek();
  }
  popI32() {
    return this.currentBlock.popI32();
  }
  popType(T) {
    return this.currentBlock.popType(T);
  }
  step() {
    const instruction = this.instructions[this.pc];
    instruction.eval(this);
    this.pc += 1;
  }
  run() {
    while (!this.finished) {
      this.step();
    }
  }
  get finished() {
    return this.pc === this.instructions.length;
  }
}


const block = instr(0x02, 'block', (vm) => {
  const breakTargetPc = vm.findMatchingEndPc();
  vm.pushFrame(new BlockFrame([], breakTargetPc));
});


const end = instr(0x0b, 'end', (vm) => {
  vm.popFrame();
});


test('block and end work', () => {
  const vm = new CallFrame([block, end]);
  vm.step();
  assert.strictEqual(vm.blocks.length, 2);
  vm.step();
  assert.strictEqual(vm.blocks.length, 1);
});


function callFrameToData(callFrame) {
  return callFrame.blocks.map((block) => block.items.map((v) => v.value));
}


test('block stacks work', () => {
  const vm = new CallFrame([
    i32.const(5),
    block,
    i32.const(10),
    drop,
    end,
    i32.const(20),
    drop,
    drop,
  ]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5], []]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5], [10]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5], []]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5, 20]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[]]);
});


const br = (labelidx) =>
  instr(
    0x0c,
    'br',
    (vm) => {
      vm.breakToLabel(labelidx);
    },
    labelidx,
  );


test('br works', () => {
  const vm = new CallFrame([
    i32.const(5),
    block,
    br(0),
    i32.const(10),
    drop,
    end,
    i32.const(20),
    drop,
    drop,
  ]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5], []]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5, 20]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[]]);
});


const br_if = (labelidx) =>
  instr(
    0x0d,
    'br_if',
    (vm) => {
      const condValue = vm.popI32();
      if (condValue !== 0) {
        vm.breakToLabel(labelidx);
      }
    },
    labelidx,
  );


test('br_if works', () => {
  const vm = new CallFrame([
    i32.const(5),
    block,
    i32.const(1),
    br_if(0),
    i32.const(10),
    drop,
    end,
    i32.const(20),
    drop,
    drop,
  ]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5], []]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5], [1]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5, 20]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[5]]);
  vm.step();
  assert.deepStrictEqual(callFrameToData(vm), [[]]);
});


const loop = instr(0x03, 'loop', (vm) => {
  // rt.pc - 1 as target because step will increment pc after
  vm.pushFrame(new BlockFrame([], vm.pc - 1));
});


test('loop breaks to the top', () => {
  const vm = new CallFrame([nop, loop, br(0), end]);
  vm.step();
  vm.step();
  assert.strictEqual(vm.pc, 2);
  vm.step();
  assert.strictEqual(vm.pc, 1);
});


const if_ = instr(0x04, 'if', (vm) => {
  const condValue = vm.popI32().value;
  if (condValue !== 0) {
    const breakTargetPc = vm.findMatchingEndPc();
    vm.pushFrame(new BlockFrame([], breakTargetPc));
  } else {
    // TODO: if always has an else?
    vm.pc = vm.findMatchingElsePc();
    const breakTargetPc = vm.findMatchingEndPc();
    vm.pushFrame(new BlockFrame([], breakTargetPc));
  }
});


const else_ = instr(0x05, 'else', (vm) => {
  const frame = vm.popFrame();
  vm.pc = frame.breakTargetPc;
});


test('if(false) jumps past else', () => {
  const vm = new CallFrame([
    i32.const(0),
    if_,
    i32.const(10),
    drop,
    else_,
    i32.const(20),
    drop,
    end,
  ]);
  vm.step();
  vm.step();
  assert.strictEqual(vm.pc, 5);
  assert.deepStrictEqual(callFrameToData(vm), [[], []]);
});


test('if(true) enters body', () => {
  const vm = new CallFrame([
    i32.const(1),
    if_,
    i32.const(10),
    drop,
    else_,
    i32.const(20),
    drop,
    end,
  ]);
  vm.step();
  vm.step();
  assert.strictEqual(vm.pc, 2);
  assert.deepStrictEqual(callFrameToData(vm), [[], []]);
});


test('else jumps past end', () => {
  const vm = new CallFrame([
    i32.const(1),
    if_,
    i32.const(10),
    drop,
    else_,
    i32.const(20),
    drop,
    end,
  ]);
  vm.step();
  vm.step();
  vm.step();
  vm.step();
  vm.step();
  assert.strictEqual(vm.pc, 8);
  assert.deepStrictEqual(callFrameToData(vm), [[]]);
});


test('if(true) jumps past nested ends/elses', () => {
  const vm = new CallFrame([
    i32.const(1),
    if_,
    // {
    i32.const(1),
    if_,
    i32.const(10),
    drop,
    else_,
    i32.const(20),
    drop,
    end,
    // }
    else_,
    i32.const(20),
    drop,
    end,
  ]);
  vm.step();
  vm.step();
  assert.strictEqual(vm.pc, 2);
  assert.strictEqual(vm.currentBlock.breakTargetPc, 13);
});


test('if(false) jumps past nested ends/elses', () => {
  const vm = new CallFrame([
    i32.const(0),
    if_,
    // {
    i32.const(1),
    if_,
    i32.const(10),
    drop,
    else_,
    i32.const(20),
    drop,
    end,
    // }
    else_,
    i32.const(20),
    drop,
    end,
  ]);
  vm.step();
  vm.step();
  assert.strictEqual(vm.pc, 11);
  assert.strictEqual(vm.currentBlock.breakTargetPc, 13);
});


class Func {
  constructor(args = [], returns = [], locals = [], instructions = []) {
    this.instructions = instructions;
    this.locals = locals;
    this.args = args;
    this.returns = returns;
  }
}


class Instance {
  constructor() {
    this.callStack = [];
    this.functions = [];
    this.globals = [];
  }

  get currentFrame() {
    return this.callStack.at(-1);
  }

  addFunction(func) {
    const index = this.functions.length;
    this.functions.push(func);
    return index;
  }

  callFunction(index) {
    const fn = this.functions[index];
    const callingFrame = this.currentFrame;
    const calledFrame = new CallFrame(
      fn.instructions,
      fn.locals.map((T) => new T()), // T=I32, ...
      [fn.args, fn.returns],
    );
    // TODO: validate arg type?
    for (let i = 0; i < fn.args.length; i++) {
      const value = callingFrame.pop();
      calledFrame.push(value);
    }
    this.callStack.push(calledFrame);
  }
  step() {
    const {currentFrame} = this;
    const instruction = currentFrame.instructions[currentFrame.pc];
    instruction.eval(this);
    // this will increment pc in caller frame if instruction is a call
    currentFrame.pc += 1;
    // if instruction is a call then currentFrame changed after eval
    const newCurrentFrame = this.currentFrame;
    if (newCurrentFrame.finished) {
      const frame = this.callStack.pop();
      if (this.callStack.length > 0) {
        // TODO: validate return type?
        while (frame.currentBlock.size > 0) {
          const value = frame.pop();
          this.currentFrame.push(value);
        }
      }
    }
  }
  // runtime interface
  findMatchingEndPc() {
    return this.currentFrame.findMatchingEndPc();
  }
  findMatchingElsePc() {
    return this.currentFrame.findMatchingElsePc();
  }
  findMatchingIfPc() {
    return this.currentFrame.findMatchingIfPc();
  }
  breakToLabel(labelidx) {
    return this.currentFrame.breakToLabel(labelidx);
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
}


function instanceToData(instance) {
  return instance.callStack.map((frame) => callFrameToData(frame));
}


test('single function instance', () => {
  const instance = new Instance();
  assert.deepStrictEqual(instanceToData(instance), []);
  const fn = new Func([], [], [], [nop]);
  const index = instance.addFunction(fn);
  instance.callFunction(index);
  assert.deepStrictEqual(instanceToData(instance), [[[]]]);
  instance.step();
  assert.deepStrictEqual(instanceToData(instance), []);
});


const call = (index) =>
  instr(0x10, 'call', (rt) => rt.callFunction(index), index);


test('call instruction', () => {
  const instance = new Instance();
  assert.deepStrictEqual(instanceToData(instance), []);
  const fn1 = new Func([], [], [], [call(1)]);
  const fn2 = new Func([], [], [], [nop]);
  instance.addFunction(fn1);
  instance.addFunction(fn2);
  instance.callFunction(0);
  assert.deepStrictEqual(instanceToData(instance), [[[]]]);
  instance.step();
  assert.deepStrictEqual(instanceToData(instance), [[[]], [[]]]);
  instance.step();
  assert.deepStrictEqual(instanceToData(instance), [[[]]]);
  assert.strictEqual(instance.currentFrame.finished, true);
});


test('call fn returns instruction', () => {
  const instance = new Instance();
  assert.deepStrictEqual(instanceToData(instance), []);
  const fn1 = new Func([], [], [], [i32.const(10), call(1)]);
  const fn2 = new Func([I32], [I32], [], [i32.const(5), i32.add]);
  instance.addFunction(fn1);
  instance.addFunction(fn2);
  instance.callFunction(0);
  assert.deepStrictEqual(instanceToData(instance), [[[]]]);
  instance.step();
  assert.deepStrictEqual(instanceToData(instance), [[[10]]]);
  instance.step();
  assert.deepStrictEqual(instanceToData(instance), [[[]], [[10]]]);
  instance.step();
  assert.deepStrictEqual(instanceToData(instance), [[[]], [[10, 5]]]);
  instance.step();
  assert.deepStrictEqual(instanceToData(instance), [[[15]]]);
  assert.strictEqual(instance.currentFrame.finished, true);
});


function assertGlobalIndexInRange(globals, index) {
  if (index < 0 || index >= globals.length) {
    throw new Error(`Invalid global index: ${index}`);
  }
}


const global = {};
global.get = (index) =>
  instr(
    0x23,
    'global.get',
    (vm) => {
      assertLocalIndexInRange(vm.globals, index);
      const value = vm.globals[index];
      vm.push(value);
    },
    index,
  );


test('global.get', () => {
  const instance = new Instance();
  instance.globals.push(i32(100));
  instance.addFunction(new Func([], [], [], [global.get(0), nop]));
  instance.callFunction(0);
  instance.step();
  assert.strictEqual(instance.peek().value, 100);
});


global.set = (index) =>
  instr(
    0x24,
    'global.set',
    (vm) => {
      assertGlobalIndexInRange(vm.globals, index);
      const value = vm.pop();
      vm.globals[index] = value;
    },
    index,
  );


test('global.set', () => {
  const instance = new Instance();
  instance.globals.push(i32(0));
  instance.addFunction(new Func([], [], [], [i32.const(42), global.set(0)]));
  instance.callFunction(0);
  instance.step();
  instance.step();
  assert.strictEqual(instance.globals[0].value, 42);
});


export {local, global};
