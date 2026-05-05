-- Complete a job by removing from processing and unlocking the group
-- Does NOT record job metadata - that's handled separately by record-job-result.lua
-- argv: ns, jobId, groupId
local ns = KEYS[1]
local jobId = ARGV[1]
local gid = ARGV[2]

-- Remove from processing
redis.call("DEL", ns .. ":processing:" .. jobId)
redis.call("ZREM", ns .. ":processing", jobId)

-- Remove from group active list (BullMQ-style)
local groupActiveKey = ns .. ":g:" .. gid .. ":active"
local removed = redis.call("LREM", groupActiveKey, 1, jobId)

-- Check if there are more jobs in this group
local gZ = ns .. ":g:" .. gid
local jobCount = redis.call("ZCARD", gZ)
if jobCount == 0 then
  -- Remove empty group
  redis.call("DEL", gZ)
  redis.call("SREM", ns .. ":groups", gid)
  redis.call("ZREM", ns .. ":ready", gid)
  redis.call("DEL", ns .. ":buffer:" .. gid)
  redis.call("ZREM", ns .. ":buffering", gid)
  redis.call("DEL", groupActiveKey)
else
  -- Group has more jobs, re-add to ready if not buffering
  local groupBufferKey = ns .. ":buffer:" .. gid
  local isBuffering = redis.call("EXISTS", groupBufferKey)

  if isBuffering == 0 then
    local nextHead = redis.call("ZRANGE", gZ, 0, 0, "WITHSCORES")
    if nextHead and #nextHead >= 2 then
      local nextScore = tonumber(nextHead[2])
      redis.call("ZADD", ns .. ":ready", nextScore, gid)
    end
  end
end

return 1
