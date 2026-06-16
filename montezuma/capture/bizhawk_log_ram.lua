-- BizHawk Lua RAM logger for Montezuma's Revenge (Atari 2600).
-- ALTERNATIVE to ale_ram_logger.py — use this when you want a GUI emulator:
-- frame-step by hand, watch RAM live, and capture sprite frames visually.
--
-- Setup:
--   1. Open Montezuma's Revenge (.bin/.a26) in BizHawk (Atari 2600 / Stella core).
--   2. Tools -> Lua Console -> Open this script.
--   3. Play (or load an input movie). It appends one CSV row per frame.
--
-- Output: bizhawk_ram.csv next to the ROM (BizHawk's working dir).
-- Addresses MUST match capture/ram_map.json — keep them in sync.

local ADDR = { room = 3, x = 42, y = 43, lives = 58 }   -- VERIFY against ram_map.json
local OUT  = "bizhawk_ram.csv"

local f = io.open(OUT, "w")
f:write("frame,action,room,x,y,lives,dx,dy\n")

local prev_x, prev_y = nil, nil

-- 2600 RAM is mirrored; memory.read_u8 on the "System Bus" reads it directly.
memory.usememorydomain("System Bus")

while true do
  local room  = memory.read_u8(ADDR.room)
  local x     = memory.read_u8(ADDR.x)
  local y     = memory.read_u8(ADDR.y)
  local lives = memory.read_u8(ADDR.lives)

  local dx = prev_x and (x - prev_x) or ""
  local dy = prev_y and (y - prev_y) or ""
  prev_x, prev_y = x, y

  -- joypad.get returns the held buttons this frame (P1)
  local j = joypad.get(1)
  local act = (j.Left and "L" or "") .. (j.Right and "R" or "")
           .. (j.Up and "U" or "") .. (j.Down and "D" or "") .. (j.Button and "F" or "")
  if act == "" then act = "-" end

  f:write(string.format("%d,%s,%d,%d,%d,%d,%s,%s\n",
          emu.framecount(), act, room, x, y, lives, tostring(dx), tostring(dy)))
  f:flush()

  emu.frameadvance()  -- yields until the next emulated frame
end
