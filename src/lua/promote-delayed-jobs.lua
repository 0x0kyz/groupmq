-- argv: ns, now
local ns = KEYS[1]
local now = tonumber(ARGV[1])

local delayedKey = ns .. ":delayed"
local readyKey = ns .. ":ready"

local promotedCount = 0

-- Get jobs that are ready (score <= now)
local readyJobs = redis.call("ZRANGEBYSCORE", delayedKey, 0, now)

for i = 1, #readyJobs do
  local jobId = readyJobs[i]
  local jobKey = ns .. ":job:" .. jobId
  local h = redis.call("HMGET", jobKey, "groupId", "score")
  local groupId = h[1]
  local score = tonumber(h[2])

  if groupId and score then
    local gZ = ns .. ":g:" .. groupId

    -- Remove from delayed set
    redis.call("ZREM", delayedKey, jobId)

    -- Update job status to waiting (matching promote-delayed-one.lua)
    redis.call("HSET", jobKey, "status", "waiting")
    redis.call("HDEL", jobKey, "runAt")

    -- Ensure job is in group ZSET (delayed jobs may not have been added)
    redis.call("ZADD", gZ, score, jobId)

    -- Update ready queue with group's head score
    local head = redis.call("ZRANGE", gZ, 0, 0, "WITHSCORES")
    if head and #head >= 2 then
      local headScore = tonumber(head[2])
      redis.call("ZADD", readyKey, headScore, groupId)
    end

    promotedCount = promotedCount + 1
  end
end

return promotedCount
