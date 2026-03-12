-- argv: ns, jobId, groupId, extendMs
local ns = KEYS[1]
local jobId = ARGV[1]
local gid = ARGV[2]
local extendMs = tonumber(ARGV[3])

-- BullMQ-style: only extend processing deadline, no group lock
local processingKey = ns .. ":processing"
local stillProcessing = redis.call("ZSCORE", processingKey, jobId)
if stillProcessing then
  local t = redis.call("TIME")
  local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
  local newDeadline = now + extendMs
  redis.call("ZADD", processingKey, newDeadline, jobId)
  return 1
end
return 0
