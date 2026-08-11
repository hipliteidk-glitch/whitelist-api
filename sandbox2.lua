local function run()
    local log = {}
    local lOD = setmetatable({}, {
        __index = function(t, k)
            log[k] = true
            return "__RESOLVED__"
        end
    })
    local env = {
        lOD = lOD,
        print = function(...) end,
        table = table,
        string = string,
        math = math,
        bit32 = bit32,
        game = {},
        Instance = {},
        require = function() end,
        setmetatable = setmetatable,
        getfenv = function() return env end,
        setfenv = function() end,
        pcall = function(f) return true, f() end,
        xpcall = function(f, e) return true, f() end,
        wait = function() end,
        tick = os.time,
        os = os,
        coroutine = coroutine,
        debug = { getinfo = function() return {} end },
        _G = {},
    }
    env._G = env
    env.getfenv = function() return env end
    env.setfenv = function(f, t) return f end
    local f, err = loadfile('ViolenceDistrict.lua', 't', env)
    if not f then return nil, err end
    local ok, res = pcall(f)
    if not ok then return nil, res end
    return log, env
end

local log, env = run()
if not log then
    print('ERROR: ' .. tostring(env))
    os.exit(1)
end

local idxs = {}
for k in pairs(log) do idxs[#idxs+1] = k end
table.sort(idxs)
local mapping = {}
local BID1 = env.BID1
if not BID1 then
    print('BID1 not found in env')
    os.exit(1)
end
for _, idx in ipairs(idxs) do
    local s = BID1[idx]
    if s then
        local bytes = {}
        for i = 1, #s do
            bytes[i] = bit32.bxor(string.byte(s, i), 95)
        end
        mapping[idx] = string.char(table.unpack(bytes))
    end
end

local result = {}
for idx, str in pairs(mapping) do
    result[#result+1] = 'lOD[' .. idx .. '] = "' .. str:gsub('\\', '\\\\'):gsub('"', '\\"') .. '"'
end
table.sort(result)
print('local lOD = {}')
for _, line in ipairs(result) do print(line) end
print('return lOD')
