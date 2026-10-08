-- playtrain_oracle.lua: a wrapper level for the DMLab oracle (PlayTrain, original code).
--
-- Loads the DMLab level named by the environment variable PT_LEVEL (for
-- example 'contributed.dmlab30.explore_goal_locations_small') unchanged, and
-- adds string observations the dumper needs and DMLab does not expose:
--
--   PT.ENTITIES  every entity the map spawns this episode, in spawn order,
--                after the level's own updateSpawnVars filter:
--                "<n>|classname x y z id angle targetname spawnflags;..." where n counts nextMap calls
--                (1 = the first map, 2+ = quick restarts, e.g. after a goal),
--                so respawns are data too.
--   PT.PLAYER    every field of game:playerInfo() as one line, keys sorted.
--   PT.THEME     the texture choices the map's theme made this episode, which
--                DMLab draws from its map RNG and so cannot be recomputed:
--                "V <variation> floor=<tex> ceiling=<tex> wall=<tex>" per
--                maze variation asked for, "D <k=v,...> decal=<tex>" per wall
--                decal and "M <k=v,...> model=<mod>" per floor model.
--
-- It changes nothing the level does: every hook calls through to the
-- original and returns its result.
local custom_observations = require 'decorators.custom_observations'
local game = require 'dmlab.system.game'

-- Wrap themes.fromTextureSet BEFORE the level loads, so every theme a map
-- maker builds reports what it chose. make_map looks the function up at call
-- time, so replacing the table field is enough.
local themes = require 'themes.themes'
local themeLog = {}

local function kv(t)
  local keys = {}
  for k, _ in pairs(t) do keys[#keys + 1] = tostring(k) end
  table.sort(keys)
  local out = {}
  for _, k in ipairs(keys) do
    local v = t[k]
    if v == nil then v = t[tonumber(k)] end
    if type(v) == 'table' then v = v.tex or v.mod or '{table}' end
    out[#out + 1] = k .. '=' .. tostring(v)
  end
  return table.concat(out, ',')
end

local fromTextureSet = themes.fromTextureSet
function themes.fromTextureSet(opts)
  local theme = fromTextureSet(opts)
  local mazeVariation = theme.mazeVariation
  local seen = {}
  function theme:mazeVariation(variation)
    local v = mazeVariation(self, variation)
    if not seen[variation] then
      seen[variation] = true
      themeLog[#themeLog + 1] = string.format('V %s floor=%s ceiling=%s wall=%s',
          tostring(variation), v.floor and v.floor.tex or '-',
          v.ceiling and v.ceiling.tex or '-', v.wallN and v.wallN.tex or '-')
    end
    return v
  end
  if theme.placeWallDecals then
    local placeWallDecals = theme.placeWallDecals
    function theme:placeWallDecals(allWallLocations)
      local byIndex = {}
      for _, loc in ipairs(allWallLocations) do byIndex[loc.index] = loc end
      local out = placeWallDecals(self, allWallLocations)
      for _, d in ipairs(out) do
        themeLog[#themeLog + 1] = 'D ' .. kv(byIndex[d.index] or {index = d.index}) ..
            ' decal=' .. tostring(d.decal and d.decal.tex)
      end
      return out
    end
  end
  if theme.placeFloorModels then
    local placeFloorModels = theme.placeFloorModels
    function theme:placeFloorModels(allFloorLocations)
      local byIndex = {}
      for _, loc in ipairs(allFloorLocations) do byIndex[loc.index] = loc end
      local out = placeFloorModels(self, allFloorLocations)
      for _, m in ipairs(out) do
        themeLog[#themeLog + 1] = 'M ' .. kv(byIndex[m.index] or {index = m.index}) ..
            ' model=' .. tostring(m.model and m.model.mod)
      end
      return out
    end
  end
  return theme
end

-- Wrap human_recognisable_pickups.create the same way, so the object
-- categories a level builds (shape, pattern, colours, scale, reward) are data.
-- Wrap custom_floors.setVariationColor (language levels colour each room's
-- floor per round): PT.FLOORS logs "<start> <region> r,g,b" per call.
local custom_floors = require 'decorators.custom_floors'
local floorLog = {}
local floorStarts = 0
local setVariationColor = custom_floors.setVariationColor
function custom_floors.setVariationColor(variation, color)
  floorLog[#floorLog + 1] = string.format('%d %s %d,%d,%d', floorStarts, tostring(variation),
      color[1], color[2], color[3])
  return setVariationColor(variation, color)
end

local hrp = require 'common.human_recognisable_pickups'
local pickupLog = {}
local hrpCreate = hrp.create
function hrp.create(kwargs)
  local classname = hrpCreate(kwargs)
  local function rgb(c) return c and table.concat(c, ',') or '-' end
  pickupLog[#pickupLog + 1] = string.format('%s shape=%s pattern=%s color1=%s color2=%s scale=%s quantity=%s',
      tostring(classname), tostring(kwargs.shape), tostring(kwargs.pattern), rgb(kwargs.color1),
      rgb(kwargs.color2), tostring(kwargs.scale), tostring(kwargs.quantity))
  return classname
end

-- And make_map.makeMap, for levels that generate a text map without going
-- through the maze decorator (rooms_keys_doors_puzzle): the entity and
-- variation layers it was given are data.
local make_map = require 'common.make_map'
local mapLog = {}
local makeMap = make_map.makeMap
function make_map.makeMap(kwargs)
  mapLog[#mapLog + 1] = 'MAKEMAP name=' .. tostring(kwargs.mapName) .. '\n' ..
      tostring(kwargs.mapEntityLayer) .. '\nVARIATIONS\n' .. tostring(kwargs.mapVariationsLayer)
  return makeMap(kwargs)
end

local name = os.getenv('PT_LEVEL')
assert(name, 'PT_LEVEL is not set')
local api = require(name)

local starts = 0
local log = {}

local function fmt(v)
  return string.format('%.6f', v)
end

-- createPickup decides what a pickup spawn point actually is (model,
-- reward) in levels that choose objects at run time (rooms_select_nonmatching_object).
local createPickup = api.createPickup
if createPickup then
  function api:createPickup(classname)
    local p = createPickup(self, classname)
    if p then
      pickupLog[#pickupLog + 1] = string.format('CREATE %s model=%s quantity=%s type=%s name=%s',
          tostring(classname), tostring(p.model), tostring(p.quantity), tostring(p.type), tostring(p.name))
    end
    return p
  end
end

local start = api.start
function api:start(episode, seed)
  starts = 0
  floorLog = {}
  log = {}
  themeLog = {}
  pickupLog = {}
  mapLog = {}
  return start(self, episode, seed)
end

local nextMap = api.nextMap
function api:nextMap()
  starts = starts + 1
  floorStarts = starts
  local m = nextMap(self)
  mapLog[#mapLog + 1] = string.format('NEXTMAP %d %s', starts, tostring(m))
  return m
end

-- PT_SPAWN="x y yaw" (probes only, never set by dump_level.py): move the
-- spawn the level chose to (x, y) facing yaw, to drive controlled approaches.
local ptSpawn = os.getenv('PT_SPAWN')

local updateSpawnVars = api.updateSpawnVars
function api:updateSpawnVars(spawnVars)
  local out = spawnVars
  if updateSpawnVars then out = updateSpawnVars(self, spawnVars) end
  if out and ptSpawn and out.classname == 'info_player_start' then
    local x, y, yaw = ptSpawn:match('(%S+) (%S+) (%S+)')
    out.origin = x .. ' ' .. y .. ' 30'
    out.angle = yaw
  end
  if out then
    log[#log + 1] = string.format('%d|%s %s %s %s %s %s', starts, tostring(out.classname),
        tostring(out.origin or '-'), tostring(out.id or '-'), tostring(out.angle or '-'),
        tostring(out.targetname or '-'), tostring(out.spawnflags or '-'))
  end
  return out
end

local function entities()
  return table.concat(log, ';')
end

local function player()
  local i = game:playerInfo()
  local parts = {}
  local keys = {}
  for k, _ in pairs(i) do keys[#keys + 1] = k end
  table.sort(keys)
  for _, k in ipairs(keys) do
    local v = i[k]
    if type(v) == 'table' then
      local xs = {}
      for n = 1, #v do xs[#xs + 1] = fmt(v[n]) end
      parts[#parts + 1] = k .. '=' .. table.concat(xs, ',')
    elseif type(v) == 'number' then
      parts[#parts + 1] = k .. '=' .. string.format('%.6f', v)
    else
      parts[#parts + 1] = k .. '=' .. tostring(v)
    end
  end
  return table.concat(parts, ' ')
end

custom_observations.addSpec('PT.ENTITIES', 'String', {0}, entities)
custom_observations.addSpec('PT.THEME', 'String', {0},
    function() return table.concat(themeLog, '\n') end)
-- Level state some factories keep in their api table and nowhere else
-- (rooms_keys_doors_puzzle: which key colours exist, which colour opens each
-- door): read, never written.
local function levelState()
  local out = {}
  if type(api._keys) == 'table' then
    for i, c in ipairs(api._keys) do out[#out + 1] = string.format('KEY %d %s', i, tostring(c)) end
  end
  -- Per-map config flags the rooms factories choose with their own RNG.
  for _, k in ipairs{'_replaceWallAndFloor', '_doorOpened', '_hasBox'} do
    if api[k] ~= nil then out[#out + 1] = string.format('CONFIG %s %s', k, tostring(api[k])) end
  end
  if type(api._doors) == 'table' then
    local names = {}
    for k, _ in pairs(api._doors) do names[#names + 1] = k end
    table.sort(names)
    for _, k in ipairs(names) do out[#out + 1] = string.format('DOORCOLOR %s %s', k, tostring(api._doors[k])) end
  end
  return table.concat(out, '\n')
end

custom_observations.addSpec('PT.MAP', 'String', {0},
    function()
      local st = levelState()
      return table.concat(mapLog, '\n') .. (st ~= '' and ('\n' .. st) or '')
    end)
custom_observations.addSpec('PT.PICKUPS', 'String', {0},
    function() return table.concat(pickupLog, '\n') end)
custom_observations.addSpec('PT.PLAYER', 'String', {0}, player)
custom_observations.addSpec('PT.FLOORS', 'String', {0},
    function() return table.concat(floorLog, '\n') end)

-- Psychlab (tier 2): where the view ray meets the screen, and the screen.
--   PT.GAZE    "<looking> <x> <y>": looking is 1 when the ray hits the screen
--              this frame, x y the hit in the screen's [0, 1] coordinates, y
--              down: (pos[1], 1 - pos[3]) of the level's own api:lookat, the
--              mapping psychlab's factory feeds its widgets (pos[2] is depth).
--   PT.SCREEN  the screen texture the level last uploaded (H x W x 4 bytes).
if api.lookat then
  local gaze = {0, 0, 0}
  local lookat = api.lookat
  function api:lookat(ent, lookedAt, pos)
    gaze = {lookedAt and 1 or 0, pos and pos[1] or 0, pos and (1.0 - pos[3]) or 0}
    return lookat(self, ent, lookedAt, pos)
  end
  custom_observations.addSpec('PT.GAZE', 'String', {0},
      function() return string.format('%d %.6f %.6f', gaze[1], gaze[2], gaze[3]) end)
end
if (os.getenv('PT_LEVEL') or ''):find('psychlab') then
  custom_observations.addSpec('PT.SCREEN', 'Bytes', {0, 0, 4},
      function() return api._screen end)
  -- PT.WIDGETS: the screen's widgets (point_and_click's own table, read only),
  -- "name xMin yMin xMax yMax" in screen pixels, one per line, sorted by name.
  custom_observations.addSpec('PT.WIDGETS', 'String', {0}, function()
    local pac = api._env
    if type(pac) ~= 'table' or type(pac._widgets) ~= 'table' then return '' end
    local names = {}
    for k, _ in pairs(pac._widgets) do names[#names + 1] = k end
    table.sort(names)
    local out = {}
    for _, k in ipairs(names) do
      local b = pac._widgets[k].bounds
      out[#out + 1] = string.format('%s %.3f %.3f %.3f %.3f', k, b.xMin, b.yMin, b.xMax, b.yMax)
    end
    return table.concat(out, '\n')
  end)
end

return api
