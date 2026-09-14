// stubs/raylib.h — enough raylib to compile games/craftax_src/craftax_classic.h
// with its render path present but never called.
//
// The reference header includes <raylib.h> unconditionally, and its puf_render
// touches a couple of dozen raylib symbols. The parity driver never calls
// puf_render, so every function here is a no-op and every type is the minimum
// layout the header's code needs to compile. NOTHING here affects the stepped
// state; if it ever did, the driver would not be a reference.
//
// This file exists because the reference is not editable. See
// games/craftax_src/README.md.
#pragma once
#include <stdbool.h>
#include <stdio.h>

typedef struct Texture2D { unsigned int id; int width, height, mipmaps, format; } Texture2D;
typedef struct Rectangle { float x, y, width, height; } Rectangle;
typedef struct Vector2   { float x, y; } Vector2;
typedef struct Color     { unsigned char r, g, b, a; } Color;

#define WHITE ((Color){255, 255, 255, 255})
#define BLACK ((Color){  0,   0,   0, 255})

#define TEXTURE_FILTER_POINT 0
#define KEY_ESCAPE 256

static inline bool      FileExists(const char* p)                 { (void)p; return false; }
static inline Texture2D LoadTexture(const char* p)                { (void)p; Texture2D t = {0,0,0,0,0}; return t; }
static inline void      SetTextureFilter(Texture2D t, int f)      { (void)t; (void)f; }
static inline void      DrawTexturePro(Texture2D t, Rectangle s, Rectangle d, Vector2 o, float rot, Color c)
                                                                  { (void)t; (void)s; (void)d; (void)o; (void)rot; (void)c; }
static inline bool      IsWindowReady(void)                       { return false; }
static inline void      InitWindow(int w, int h, const char* ti)  { (void)w; (void)h; (void)ti; }
static inline void      SetTargetFPS(int f)                       { (void)f; }
static inline bool      IsKeyDown(int k)                          { (void)k; return false; }
static inline void      BeginDrawing(void)                        { }
static inline void      EndDrawing(void)                          { }
static inline void      ClearBackground(Color c)                  { (void)c; }
static inline void      DrawRectangle(int x, int y, int w, int h, Color c)
                                                                  { (void)x; (void)y; (void)w; (void)h; (void)c; }
static inline void      DrawText(const char* t, int x, int y, int sz, Color c)
                                                                  { (void)t; (void)x; (void)y; (void)sz; (void)c; }
static inline const char* TextFormat(const char* fmt, ...)        { (void)fmt; return ""; }
