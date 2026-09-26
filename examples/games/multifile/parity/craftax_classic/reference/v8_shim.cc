// v8_shim.cc — C linkage over V8's ieee754 cos/sin.
//
// native/qjs/v8libm/ieee754.cc declares these in namespace v8::base::ieee754
// with C++ linkage (deliberately: see native/runtime/jsmath.h). The driver is
// C, so it needs a wrapper. These are the exact functions PlayTrain's QuickJS
// host binds Math.cos and Math.sin to, which is what makes "the C's cosf" and
// "the JS's Math.cos" the same function — the parity target of PLAN 1.4.
namespace v8 { namespace base { namespace ieee754 {
double sin(double);
double cos(double);
}}}

extern "C" double cc_ieee754_cos(double x) { return v8::base::ieee754::cos(x); }
extern "C" double cc_ieee754_sin(double x) { return v8::base::ieee754::sin(x); }
