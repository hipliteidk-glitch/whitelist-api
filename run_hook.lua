local function create_sandbox()
    local env = {}
    local log = {}
    local function log_event(kind, ...)
        log[#log+1] = {kind, ...}
    end

    local function make_proxy(tbl, path)
        return setmetatable({}, {
            __index = function(_, key)
                log_event('read', path, key)
                return make_proxy(tbl, path .. '.' .. tostring(key))
            end,
            __newindex = function(_, key, value)
                log_event('write', path, key, value)
            end,
            __call = function(_, ...)
                log_event('call', path, ...)
                return make_proxy(tbl, path .. '()')
            end,
        })
    end

    local mt = {}
    mt.__index = function(_, key)
        log_event('global_read', key)
        if key == 'print' then
            return function(...) log_event('print', ...) end
        end
        return make_proxy(env, key)
    end
    mt.__newindex = function(_, key, value)
        log_event('global_write', key, value)
    end
    setmetatable(env, mt)

    -- Provide necessary globals
    env.table = table
    env.string = string
    env.math = math
    env.bit32 = bit32
    env.pairs = pairs
    env.ipairs = ipairs
    env.type = type
    env.tonumber = tonumber
    env.tostring = tostring
    env.select = select
    env.unpack = unpack or table.unpack
    env.setmetatable = setmetatable
    env.getmetatable = getmetatable
    env.rawget = rawget
    env.rawset = rawset
    env.rawequal = rawequal
    env.rawlen = rawlen
    env.pcall = pcall
    env.xpcall = xpcall
    env.error = error
    env.assert = assert
    env.getfenv = function() return env end
    env.setfenv = function(f, t) end
    env.loadstring = function(s, chunkname) return loadstring(s, chunkname) end
    env.loadfile = loadfile
    env.dofile = dofile
    env.coroutine = coroutine
    env.debug = debug
    env.os = os
    env.io = io
    env._G = env

    -- Roblox mocks
    env.game = { GetService = function() return make_proxy(env, 'game:GetService') end }
    env.Instance = { new = function(...) log_event('Instance_new', ...); return make_proxy(env, 'Instance.new()') end }
    env.Enum = {}
    env.UDim = {}
    env.UDim2 = {}
    env.Color3 = {}
    env.Vector2 = {}
    env.Vector3 = {}
    env.CFrame = {}
    env.BrickColor = {}
    env.NumberSequence = {}
    env.ColorSequence = {}
    env.NumberRange = {}
    env.Rect = {}
    env.Region3 = {}
    env.PhysicalProperties = {}
    env.Faces = {}
    env.Axes = {}
    env.RaycastParams = {}
    env.OverlapParams = {}
    env.Font = {}
    env.DateTime = {}
    env.Random = {}
    env.CatalogSearchParams = {}

    return env, log
end

local env, log = create_sandbox()
local f, err = loadfile('ViolenceDistrict_clean.lua', 't', env)
if not f then
    print('LOAD ERROR: ' .. tostring(err))
    os.exit(1)
end

local ok, res = pcall(f)
if not ok then
    print('EXECUTION ERROR: ' .. tostring(res))
end

-- Print summary of log
print('=== LOG SUMMARY ===')
local counts = {}
for _, entry in ipairs(log) do
    local kind = entry[1]
    counts[kind] = (counts[kind] or 0) + 1
end
for k, v in pairs(counts) do
    print(k .. ': ' .. v)
end

-- Print first 20 entries
print('=== FIRST 20 LOG ENTRIES ===')
for i = 1, math.min(20, #log) do
    print(table.unpack(log[i]))
end
