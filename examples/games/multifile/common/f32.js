// f32.js — float32 discipline.
//
// The C we mirror does its float work in `float`, not `double`. JavaScript has
// only doubles, so every float32 operation has to be rounded back explicitly:
// `F(F(a) * F(b))`, never `a * b`. One missed F is a divergence that may not
// show up for thousands of steps, which is why this file is one line of
// machinery and a lot of naming discipline.
//
// Math.cos and Math.sin are NOT wrapped here. They resolve, in every PlayTrain
// engine, to V8's ieee754 (native/qjs/v8libm/ieee754.cc via jsmath.h), which
// is exactly what the reference driver binds the C's cosf/sinf to. Callers
// write F(Math.cos(x)) so the double result is rounded to float32 the way
// (float)cos((double)x) does in the driver.

// eslint-disable-next-line no-unused-vars
const F = Math.fround;

// The C writes 3.14159265f. This is that literal as a float32.
const PI_F = Math.fround(3.14159265);

// float32 bit views, shared so no hot path allocates.
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

// The bit pattern of a float32, as a uint32. Used by the parity serializer and
// by any test that must compare floats as bits rather than as values.
function f32Bits(x) {
  _f32[0] = x;
  return _u32[0];
}

function bitsToF32(bits) {
  _u32[0] = bits >>> 0;
  return _f32[0];
}
