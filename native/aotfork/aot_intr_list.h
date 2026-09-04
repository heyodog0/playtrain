/* E3 (PLAN-engine-tier-round6.md): the p5 bindings the AOT emitter may call
 * directly. Single source of truth: the hosts include this twice (wrapper
 * definitions + capture table) and build_fork.sh derives the `qjsc -P` file
 * from it. AOT_INTR(name, min_argc, fn): fn = the host's JSCFunction for the
 * binding; min_argc = number of arguments fn reads unconditionally; a call with
 * fewer arguments keeps the generic path, whose undefined-padding is observable.
 * AOT_INTRM(obj, name, min_argc, fn): method <obj>.<name> reached through
 * `get_var obj; get_field2 name; ...; call_method` (Math.* here); fn must
 * reproduce js_call_c_function's behaviour for that builtin exactly (see the
 * f_f helpers in the hosts). Order defines the index k used in
 * ctx->aot_intr[k]; append only. */
AOT_INTR(rect, 4, js_rect)
AOT_INTR(fill, 1, js_fill)
AOT_INTR(stroke, 1, js_stroke)
AOT_INTR(background, 1, js_background)
AOT_INTR(noStroke, 0, js_noStroke)
AOT_INTR(noFill, 0, js_noFill)
AOT_INTR(strokeWeight, 1, js_strokeWeight)
AOT_INTR(ellipse, 3, js_ellipse)
AOT_INTR(circle, 3, js_circle)
AOT_INTR(arc, 6, js_arc)
AOT_INTR(triangle, 6, js_triangle)
AOT_INTR(quad, 8, js_quad)
AOT_INTR(line, 4, js_line)
AOT_INTR(rectMode, 1, js_rectMode)
AOT_INTR(ellipseMode, 1, js_ellipseMode)
AOT_INTR(push, 0, js_push)
AOT_INTR(pop, 0, js_pop)
AOT_INTR(translate, 2, js_translate)
AOT_INTR(rotate, 1, js_rotate)
AOT_INTR(scale, 1, js_scale)
AOT_INTR(beginShape, 0, js_beginShape)
AOT_INTR(vertex, 2, js_vertex)
AOT_INTR(endShape, 0, js_endShape)
AOT_INTR(keyIsDown, 1, js_keyIsDown)
AOT_INTR(image, 5, js_image)
AOT_INTR(setTarget, 1, js_setTarget)
AOT_INTR(clearTarget, 0, js_clearTarget)
AOT_INTR(textSize, 0, js_noop)
AOT_INTR(textAlign, 0, js_noop)
AOT_INTR(text, 0, js_noop)
AOT_INTRM(Math, floor, 1, aot_m_floor)
AOT_INTRM(Math, abs, 1, aot_m_abs)
AOT_INTRM(Math, ceil, 1, aot_m_ceil)
AOT_INTRM(Math, sqrt, 1, js_m_sqrt)
AOT_INTRM(Math, pow, 2, js_m_pow)
AOT_INTRM(Math, sin, 1, js_m_sin)
AOT_INTRM(Math, cos, 1, js_m_cos)
AOT_INTRM(Math, atan2, 2, js_m_atan2)
AOT_INTRM(Math, hypot, 2, js_m_hypot)
