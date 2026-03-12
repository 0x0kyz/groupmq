-- Fast reserve for non-grouped jobs
-- Just ZPOPMIN, no group locking
-- argv: ns, nowEpochMs, vtMs
local ns = KEYS[1]
local now = tonumber(ARGV[1])
local vt = tonumber(ARGV[2])

local simpleKey = ns .. ":simple"
local processingKey = ns .. ":processing"

-- Respect paused state
if redis.call("GET", ns .. ":paused") then
  return nil
end

-- Pop job from simple queue
local zpop = redis.call("ZPOPMIN", simpleKey, 1)
if not zpop or #zpop == 0 then
  return nil
end

local jobId = zpop[1]
local jobKey = ns .. ":job:" .. jobId

-- Get job data
local job = redis.call("HMGET", jobKey, "id", "data", "attempts", "maxAttempts", "orderMs", "timestamp")

if not job[1] or job[1] == false then
  -- Job hash missing/corrupted
  return nil
end

local id, payload, attempts, maxAttempts, orderMs, timestamp = job[1], job[2], job[3], job[4], job[5], job[6]

-- Mark as processing
local deadline = now + vt
redis.call("ZADD", processingKey, deadline, id)
redis.call("HSET", jobKey, "status", "processing")

-- Create processing metadata
local procKey = ns .. ":processing:" .. id
redis.call("HSET", procKey, "deadlineAt", tostring(deadline))

-- Return format matches grouped reserve (10 fields separated by ||GROUPMQ||)
-- id, groupId (empty), data, attempts, maxAttempts, seq (0), timestamp, orderMs, score (orderMs), deadline
return id .. "||GROUPMQ||" .. "" .. "||GROUPMQ||" .. payload .. "||GROUPMQ||" .. attempts .. "||GROUPMQ||" .. maxAttempts .. "||GROUPMQ||0||GROUPMQ||" .. (timestamp or orderMs) .. "||GROUPMQ||" .. orderMs .. "||GROUPMQ||" .. orderMs .. "||GROUPMQ||" .. deadline
