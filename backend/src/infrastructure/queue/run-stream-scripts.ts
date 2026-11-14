export const PREPARE_RUN_STREAM = `
local runId = ARGV[1]
local activeGuard = ARGV[3]
if redis.call('GET', KEYS[4]) == 'deleted' then return -4 end
local serverTime = redis.call('TIME')
local nowMs = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
if tonumber(ARGV[9]) <= nowMs then return -3 end
if tonumber(ARGV[7]) <= nowMs then return -2 end
local epoch = redis.call('GET', KEYS[7])
if not epoch then
  redis.call('SET', KEYS[7], '0')
  epoch = '0'
end
if epoch ~= ARGV[6] then return -1 end
if redis.call('ZSCORE', KEYS[1], runId) then redis.call('ZADD', KEYS[1], ARGV[7], runId) end
if redis.call('ZSCORE', KEYS[1], runId) then
  if not redis.call('GET', KEYS[4]) then redis.call('SET', KEYS[4], activeGuard) end
  return 1
end
if redis.call('ZCARD', KEYS[1]) >= 24 then return 0 end
redis.call('ZADD', KEYS[1], ARGV[7], runId)
redis.call('SET', KEYS[4], activeGuard)
redis.call('HSET', KEYS[8], runId, ARGV[8])
return 1
`;

export const RECONCILE_RUN_STREAMS = `
local serverTime = redis.call('TIME')
local nowMs = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
local count = tonumber(ARGV[2])
if tonumber(ARGV[3]) <= nowMs then return -1 end
local epoch = redis.call('GET', KEYS[3])
if not epoch then
  redis.call('SET', KEYS[3], '0')
  epoch = '0'
end
if epoch ~= ARGV[1] then return -1 end
for index = 1, count do
  local id = ARGV[3 + ((index - 1) * 2) + 1]
  local context = ARGV[3 + ((index - 1) * 2) + 2]
  local streamKey = KEYS[4 + ((index - 1) * 3)]
  local guardKey = KEYS[5 + ((index - 1) * 3)]
  local generationKey = KEYS[6 + ((index - 1) * 3)]
  if redis.call('HGET', KEYS[2], id) == context then
    redis.call('DEL', streamKey, guardKey, generationKey)
    redis.call('ZREM', KEYS[1], id)
    redis.call('HDEL', KEYS[2], id)
    redis.call('INCR', KEYS[3])
  end
end
return 1
`;

export const DELETE_RUN_STREAMS = `
for i = 2, #ARGV do
  local runId = ARGV[i]
  local member = redis.call('HGET', KEYS[4], runId)
  redis.call('ZREM', KEYS[1], runId)
  if member then redis.call('ZREM', KEYS[2], member) end
  redis.call('HDEL', KEYS[3], runId)
  redis.call('HDEL', KEYS[4], runId)
  local keyIndex = 5 + (i - 2) * 3
  redis.call('DEL', KEYS[keyIndex], KEYS[keyIndex + 2])
  redis.call('SET', KEYS[keyIndex + 1], 'deleted', 'EX', ARGV[1])
end
return #ARGV - 1
`;

export const APPEND_RUN_STREAM = `
local runId = ARGV[1]
local incoming = ARGV[2]
local event = ARGV[3]
local maxLen = ARGV[4]
local generation = ARGV[12]
local streamExists = 0
if #KEYS >= 5 and generation then
  streamExists = redis.call('EXISTS', KEYS[2])
  local storedGeneration = redis.call('GET', KEYS[5])
  if streamExists == 0 then
    if storedGeneration and tonumber(storedGeneration) > tonumber(generation) then return -1 end
  elseif storedGeneration ~= generation then
    return -1
  end
end
local serverTime = redis.call('TIME')
local nowMs = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
if tonumber(ARGV[9]) <= nowMs then return -3 end
if tonumber(ARGV[8]) <= nowMs then return -2 end
local epoch = redis.call('GET', KEYS[4])
if not epoch then
  redis.call('SET', KEYS[4], '0')
  epoch = '0'
end
if epoch ~= ARGV[7] then return -1 end
if not redis.call('ZSCORE', KEYS[1], runId) then return -1 end
local guard = redis.call('GET', KEYS[3])
local stepOpen = '0'
local textPartId = ''
if guard then
  local state, version, sequence, fence = string.match(guard, '^(%w+)|(%d+)|(%d+)|(%d+)')
  local framing = string.match(guard, '^%w+|%d+|%d+|%d+|(.*)$')
  local oldStepOpen, oldTextPartId = string.match(framing or '', '^(%d)|(.*)$')
  if state == 'closed' then return -1 end
  if version and (tonumber(incoming) < tonumber(version) or
    (tonumber(incoming) == tonumber(version) and tonumber(ARGV[5]) < tonumber(sequence)) or
    (tonumber(incoming) == tonumber(version) and tonumber(ARGV[5]) == tonumber(sequence) and tonumber(ARGV[6]) < tonumber(fence))) then return -1 end
  stepOpen = oldStepOpen or '0'
  textPartId = oldTextPartId or ''
end
if ARGV[10] == 'start-step' then stepOpen = '1' end
if ARGV[10] == 'finish-step' or ARGV[10] == 'reset-step' or ARGV[10] == 'reset' then
  stepOpen = '0'
  textPartId = ''
end
if ARGV[10] == 'text-start' then textPartId = ARGV[11] end
if ARGV[10] == 'text-end' and textPartId == ARGV[11] then textPartId = '' end
redis.call('SET', KEYS[3], 'open|' .. incoming .. '|' .. ARGV[5] .. '|' .. ARGV[6] .. '|' .. stepOpen .. '|' .. textPartId)
if #KEYS >= 5 and generation and streamExists == 0 then
  redis.call('SET', KEYS[5], generation)
end
local id = redis.call('XADD', KEYS[2], 'MAXLEN', '=', maxLen, '*', 'event', event, 'generation', generation or '0')
if generation then return id end
return 1
`;

export const APPEND_COMMITTED_RUN_STREAM = `
local runId = ARGV[1]
local incoming = ARGV[2]
local event = ARGV[3]
local maxLen = ARGV[4]
local generation = ARGV[10]
if redis.call('HGET', KEYS[4], runId) ~= ARGV[6] then return -1 end
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
if redis.call('GET', KEYS[5]) ~= generation then return -1 end
local guard = redis.call('GET', KEYS[2])
if not guard then return -1 end
local serverTime = redis.call('TIME')
local nowMs = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
if tonumber(ARGV[7]) <= nowMs then return -3 end
local epoch = redis.call('GET', KEYS[3])
if not epoch then
  redis.call('SET', KEYS[3], '0')
  epoch = '0'
end
if epoch ~= ARGV[5] then return -1 end
local state, version, sequence, fence = string.match(guard, '^(%w+)|(%d+)|(%d+)|(%d+)')
if state == 'closed' or not version then return -1 end
if tonumber(incoming) < tonumber(version) or
  (tonumber(incoming) == tonumber(version) and tonumber(ARGV[8]) < tonumber(sequence)) or
  (tonumber(incoming) == tonumber(version) and tonumber(ARGV[8]) == tonumber(sequence) and tonumber(ARGV[9]) < tonumber(fence)) then return -1 end
local framing = string.match(guard, '^%w+|%d+|%d+|%d+|(.*)$')
local oldStepOpen, oldTextPartId = string.match(framing or '', '^(%d)|(.*)$')
redis.call('XADD', KEYS[1], 'MAXLEN', '=', maxLen, '*', 'event', event, 'generation', generation)
redis.call('SET', KEYS[2], 'open|' .. incoming .. '|' .. ARGV[8] .. '|' .. ARGV[9] .. '|' .. (oldStepOpen or '0') .. '|' .. (oldTextPartId or ''))
return 1
`;

export const FINISH_RUN_STREAM = `
local runId = ARGV[1]
local version = tonumber(ARGV[2])
local sequence = tonumber(ARGV[3])
local fence = tonumber(ARGV[4])
local event = ARGV[5]
local maxLen = ARGV[6]
local ttl = ARGV[7]
local now = ARGV[8]
local generation = ARGV[9]
local streamGeneration = ARGV[18]
local serverTime = redis.call('TIME')
local nowMs = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
if tonumber(ARGV[17]) <= nowMs then return -1 end
local epoch = redis.call('GET', KEYS[7])
if not epoch then
  redis.call('SET', KEYS[7], '0')
  epoch = '0'
end
if epoch ~= ARGV[12] then return -1 end
local guard = redis.call('GET', KEYS[4])
local stepOpen = '0'
local textPartId = ''
if guard then
  local state, oldVersion, oldSequence, oldFence = string.match(guard, '^(%w+)|(%d+)|(%d+)|(%d+)')
  local framing = string.match(guard, '^%w+|%d+|%d+|%d+|(.*)$')
  local oldStepOpen, oldTextPartId = string.match(framing or '', '^(%d)|(.*)$')
  if state == 'closed' or (oldVersion and (version < tonumber(oldVersion) or
    (version == tonumber(oldVersion) and sequence < tonumber(oldSequence)) or
    (version == tonumber(oldVersion) and sequence == tonumber(oldSequence) and fence < tonumber(oldFence)))) then return 0 end
  stepOpen = oldStepOpen or '0'
  textPartId = oldTextPartId or ''
end
local streamExists = redis.call('EXISTS', KEYS[3])
local storedStreamGeneration = KEYS[10] and redis.call('GET', KEYS[10]) or nil
if streamGeneration and streamGeneration ~= '' then
  if streamExists == 0 then
    if storedStreamGeneration and tonumber(storedStreamGeneration) > tonumber(streamGeneration) then return 0 end
  elseif storedStreamGeneration ~= streamGeneration then
    return 0
  end
end
local candidateId = ARGV[10]
local candidateGuard = ARGV[11]
local existingMember = redis.call('HGET', KEYS[9], runId)
if existingMember then
  if redis.call('ZSCORE', KEYS[2], existingMember) then return 0 end
  redis.call('HDEL', KEYS[9], runId)
end
if redis.call('ZCARD', KEYS[2]) >= 6 and candidateId ~= '' and redis.call('ZSCORE', KEYS[2], candidateId) then
  local candidateRunId = candidateId:match('^[^|]+')
  local candidateGeneration = candidateId:match('|([^|]+)$')
  local currentCandidateGuard = redis.call('GET', KEYS[6])
  local guardGeneration = currentCandidateGuard and currentCandidateGuard:match('^closed|%d+|%d+|%d+|([^|]+)$')
  if currentCandidateGuard and currentCandidateGuard == candidateGuard and guardGeneration == candidateGeneration then
    if KEYS[11] then redis.call('DEL', KEYS[5], KEYS[6], KEYS[11])
    else redis.call('DEL', KEYS[5], KEYS[6]) end
    redis.call('ZREM', KEYS[2], candidateId)
    redis.call('HDEL', KEYS[8], candidateRunId)
    redis.call('HDEL', KEYS[9], candidateRunId)
    redis.call('INCR', KEYS[7])
  elseif not currentCandidateGuard and not redis.call('ZSCORE', KEYS[1], candidateRunId) then
    redis.call('ZREM', KEYS[2], candidateId)
    if redis.call('HGET', KEYS[9], candidateRunId) == candidateId then
      redis.call('HDEL', KEYS[9], candidateRunId)
      redis.call('HDEL', KEYS[8], candidateRunId)
    end
    redis.call('INCR', KEYS[7])
  elseif redis.call('HGET', KEYS[9], candidateRunId) == candidateId then
    redis.call('ZREM', KEYS[2], candidateId)
    redis.call('HDEL', KEYS[9], candidateRunId)
    redis.call('INCR', KEYS[7])
  end
end
if redis.call('ZCARD', KEYS[2]) >= 6 then return -1 end
if streamGeneration and streamGeneration ~= '' and streamExists == 0 and KEYS[10] then
  redis.call('SET', KEYS[10], streamGeneration)
end
if ARGV[14] == '1' then
  local reset = cjson.encode({version = 1, runId = runId, type = 'reset', sequence = sequence})
  redis.call('XADD', KEYS[3], 'MAXLEN', '=', maxLen, '*', 'event', reset, 'generation', streamGeneration or '0')
  local start = cjson.encode({version = 1, runId = runId, type = 'start', messageId = runId})
  redis.call('XADD', KEYS[3], 'MAXLEN', '=', maxLen, '*', 'event', start, 'generation', streamGeneration or '0')
  stepOpen = '0'
  textPartId = ''
end
if textPartId ~= '' then
  local textEnd = cjson.encode({version = 1, runId = runId, type = 'text-end', id = textPartId})
  redis.call('XADD', KEYS[3], 'MAXLEN', '=', maxLen, '*', 'event', textEnd, 'generation', streamGeneration or '0')
end
if stepOpen == '1' then
  local finishStep = cjson.encode({version = 1, runId = runId, type = 'finish-step'})
  redis.call('XADD', KEYS[3], 'MAXLEN', '=', maxLen, '*', 'event', finishStep, 'generation', streamGeneration or '0')
end
if ARGV[15] ~= '' then redis.call('XADD', KEYS[3], 'MAXLEN', '=', maxLen, '*', 'event', ARGV[15], 'generation', streamGeneration or '0') end
if ARGV[16] ~= '' then redis.call('XADD', KEYS[3], 'MAXLEN', '=', maxLen, '*', 'event', ARGV[16], 'generation', streamGeneration or '0') end
redis.call('XADD', KEYS[3], 'MAXLEN', '=', maxLen, '*', 'event', event, 'generation', streamGeneration or '0')
redis.call('SET', KEYS[4], 'closed|' .. version .. '|' .. sequence .. '|' .. fence .. '|' .. generation, 'EX', ttl)
redis.call('EXPIRE', KEYS[3], ttl)
if KEYS[10] then redis.call('EXPIRE', KEYS[10], ttl) end
redis.call('ZREM', KEYS[1], runId)
local member = runId .. '|' .. generation
redis.call('ZADD', KEYS[2], now, member)
redis.call('HSET', KEYS[8], runId, ARGV[13])
redis.call('HSET', KEYS[9], runId, member)
redis.call('INCR', KEYS[7])
return 1
`;
