import assert from 'node:assert';
import test from 'node:test';


class Instruction {
  constructor(opcode, name, evalFn) {
    this.opcode = opcode;
    this.name = name;
    this.evalFn = evalFn;
  }
  eval(vm) {
    return this.evalFn(vm);
  }
}


const instr = (opcode, name, evalFn) => new Instruction(opcode, name, evalFn);


const nop = instr(0x01, 'nop', (_vm) => {});


test('nop does nothing', () => {
  const vm = null;
  nop.eval(vm);
});


class I32 {
  constructor(value) {
    this.value = value;
  }
}
const i32 = (value) => new I32(value);


class InstructionImm extends Instruction {
  constructor(opcode, name, immediate, evalFn) {
    super(opcode, name, evalFn);
    this.immediate = immediate;
  }
  eval(vm) {
    return this.evalFn(vm, this.immediate);
  }
}


const instrImm = (opcode, name, immediate, evalFn) =>
  new InstructionImm(opcode, name, immediate, evalFn);


i32.const = (value) =>
  instrImm(0x41, 'i32.const', value, (vm, imm) => vm.push(i32(imm)));


class Stack {
  constructor() {
    this.items = [];
  }
  push(value) {
    this.items.push(value);
  }
  pop() {
    return this.items.pop();
  }
  peek() {
    return this.items.at(-1);
  }
  topIsOfType(Class) {
    return this.peek() instanceof Class;
  }
  assertTopIsOfType(Class) {
    if (!this.topIsOfType(Class)) {
      throw new Error(
        `Expected ${Class.name} on top of stack, got ${this.peek()}`,
      );
    }
  }
  popType(T) {
    this.assertTopIsOfType(T);
    return this.pop();
  }
  popI32() {
    return this.popType(I32);
  }
}


test('i32.const pushes an I32 to the stack', () => {
  const vm = new Stack();
  const instr = i32.const(42);
  instr.eval(vm);
  assert.deepStrictEqual(vm.items, [i32(42)]);
});


const drop = instr(0x1a, 'drop', (vm) => vm.pop());


function run(vm, instructions) {
  for (const instr of instructions) {
    instr.eval(vm);
  }
}


test('drop pops from the stack', () => {
  const vm = new Stack();
  run(vm, [i32.const(42), drop]);
  assert.deepStrictEqual(vm.items, []);
});


i32.add = instr(0x6a, 'i32.add', (vm) => {
  const c2 = vm.popI32();
  const c1 = vm.popI32();
  const c = i32(c1.value + c2.value);
  vm.push(c);
});


test('i32.add pops two I32s and pushes their sum', () => {
  const vm = new Stack();
  run(vm, [i32.const(42), i32.const(23), i32.add]);
  assert.deepStrictEqual(vm.items, [i32(65)]);
});


class VM {
  constructor(instructions) {
    this.stack = new Stack();
    this.instructions = instructions;
    this.pc = 0;
  }
  push(value) {
    this.stack.push(value);
  }
  pop() {
    return this.stack.pop();
  }
  peek() {
    return this.stack.peek();
  }
  popI32() {
    return this.stack.popI32();
  }
  popType(T) {
    return this.stack.popType(T);
  }
  step() {
    const instruction = this.instructions[this.pc];
    instruction.eval(this);
    this.pc += 1;
  }
  steps(count) {
    for (let i = 0; i < count; i++) {
      this.step();
    }
  }
}


test('VM executes two i32.const and an i32.add', () => {
  const vm = new VM([i32.const(42), i32.const(23), i32.add]);
  vm.step(); // Eval `i32.const 42`
  assert.deepStrictEqual(vm.stack.items, [i32(42)]);
  vm.step(); // Eval `i32.const 23`
  assert.deepStrictEqual(vm.stack.items, [i32(42), i32(23)]);
  vm.step(); // Eval `i32.add`
  assert.deepStrictEqual(vm.stack.items, [i32(42 + 23)]);
});


function binop(opcode, name, fn) {
  return instr(opcode, name, (vm) => {
    // 2. Pop the value t.const c2 from the stack.
    const c2 = vm.popI32();
    // 3. Pop the value t.const c1 from the stack.
    const c1 = vm.popI32();
    // 4.1 Let c be a possible result of computing binop<t>(c1, c2).
    const c = i32(fn(c1.value, c2.value));
    // 4.2 Push the value t.const c to the stack.
    vm.push(c);
  });
}


i32.sub = binop(0x6b, 'i32.sub', (c1, c2) => c1 - c2);


function checkBinop(c1, c2, instruction, expected) {
  const vm = new VM([i32.const(c1), i32.const(c2), instruction]);
  vm.steps(3);
  assert.deepStrictEqual(vm.stack.items, [i32(expected)]);
}


test('i32.sub', () => {
  checkBinop(42, 23, i32.sub, 42 - 23);
});


i32.mul = binop(0x6c, 'i32.mul', (c1, c2) => c1 * c2);


test('i32.mul', () => {
  checkBinop(42, 23, i32.mul, 42 * 23);
});


i32.div_s = binop(0x6d, 'i32.div_s', (c1, c2) => Math.trunc(c1 / c2));


test('i32.div_s', () => {
  checkBinop(42, 23, i32.div_s, Math.trunc(42 / 23));
});


function relop(opcode, name, fn) {
  return binop(opcode, name, (c1, c2) => (fn(c1, c2) ? 1 : 0));
}


i32.eq = relop(0x46, 'i32.eq', (c1, c2) => c1 === c2);


test('i32.eq', () => {
  checkBinop(42, 23, i32.eq, 0);
  checkBinop(23, 23, i32.eq, 1);
});


i32.ne = relop(0x47, 'i32.ne', (c1, c2) => c1 !== c2);


test('i32.ne', () => {
  checkBinop(42, 23, i32.ne, 1);
  checkBinop(23, 23, i32.ne, 0);
});


i32.lt_s = relop(0x48, 'i32.lt_s', (c1, c2) => c1 < c2);


test('i32.lt_s', () => {
  checkBinop(24, 23, i32.lt_s, 0);
  checkBinop(23, 23, i32.lt_s, 0);
  checkBinop(23, 24, i32.lt_s, 1);
});


i32.gt_s = relop(0x4a, 'i32.gt_s', (c1, c2) => c1 > c2);


test('i32.gt_s', () => {
  checkBinop(24, 23, i32.gt_s, 1);
  checkBinop(23, 23, i32.gt_s, 0);
  checkBinop(23, 24, i32.gt_s, 0);
});


i32.le_s = relop(0x4c, 'i32.le_s', (c1, c2) => c1 <= c2);


test('i32.le_s', () => {
  checkBinop(24, 23, i32.le_s, 0);
  checkBinop(23, 23, i32.le_s, 1);
  checkBinop(23, 24, i32.le_s, 1);
});


i32.ge_s = relop(0x4e, 'i32.ge_s', (c1, c2) => c1 >= c2);


test('i32.ge_s', () => {
  checkBinop(24, 23, i32.ge_s, 1);
  checkBinop(23, 23, i32.ge_s, 1);
  checkBinop(23, 24, i32.ge_s, 0);
});


test('complex expression works', () => {
  // 2 * 3 + 4 == 10;
  const vm = new VM([
    i32.const(3),
    i32.const(2),
    i32.mul,
    i32.const(4),
    i32.add,
    i32.const(10),
    i32.eq,
  ]);
  vm.steps(3); // Eval `i32.const 3; i32.const 2; i32.mul`
  assert.strictEqual(vm.stack.peek().value, 6);
  vm.steps(2); // Eval `i32.const 4; i32.add`
  assert.strictEqual(vm.stack.peek().value, 10);
  vm.steps(2); // Eval `i32.const 10; i32.eq`
  assert.deepStrictEqual(vm.stack.items, [i32(1)]);
});


export {I32, drop, i32, instr, nop, Stack, VM};
