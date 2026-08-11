local env = {}
setmetatable(env, {__index = function(t,k) print('ACCESS: '..tostring(k)); return function(...) print('CALL: '..tostring(k)..'('..table.concat({...},', ')..')') end end})
local f = assert(loadfile('ViolenceDistrict.lua', 't', env))
local ok, err = pcall(f)
if not ok then print('ERROR: '..tostring(err)) end
for k,v in pairs(env) do print('GLOBAL: '..tostring(k)) end
