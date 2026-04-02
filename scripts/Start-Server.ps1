param(
  [int]$Port = 8899
)

$ErrorActionPreference = "Stop"

$ProjectRoot = "C:\Users\Administrator\Documents\game-feedback-monitor"
$DataDir = "$ProjectRoot\data"
$StorePath = "$ProjectRoot\data\store.json"
$SourcesPath = "$ProjectRoot\data\sources.json"
$ServerLogPath = "$ProjectRoot\server.runtime.log"
$MaxStoreBytes = 64MB
$script:RuleConfigCache = $null
$script:DatasetCache = $null
$script:DatasetCacheStamp = ""
Add-Type -AssemblyName System.Web.Extensions

function Write-ServerLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffK"), $Message
  Add-Content -Path $ServerLogPath -Value $line -Encoding UTF8
}

function ConvertTo-PsJsonValue {
  param($Value)

  if ($null -eq $Value) {
    return $null
  }

  if ($Value -is [System.Collections.IDictionary]) {
    $ordered = [ordered]@{}
    foreach ($key in $Value.Keys) {
      $ordered[$key] = ConvertTo-PsJsonValue -Value $Value[$key]
    }
    return [pscustomobject]$ordered
  }

  if (($Value -is [System.Collections.IEnumerable]) -and ($Value -isnot [string])) {
    $items = @()
    foreach ($item in $Value) {
      $items += ,(ConvertTo-PsJsonValue -Value $item)
    }
    return $items
  }

  return $Value
}

function Read-JsonFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $null }
  $fileInfo = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
  if ($fileInfo -and $fileInfo.Length -ge 8MB) {
    Invoke-MemoryCleanup
  }
  $raw = Get-Content -LiteralPath $Path -Raw
  try {
    return ($raw | ConvertFrom-Json)
  } catch {
    Write-ServerLog ("ConvertFrom-Json failed for {0}: {1}" -f $Path, $_.Exception.Message)
    try {
      $normalizedPath = [System.IO.Path]::GetTempFileName()
      $nodeScript = @"
const fs = require('fs');
const args = process.argv.slice(1);
const inputPath = args[0];
const outputPath = args[1];
const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const normalized = JSON.stringify(data, null, 2).replace(/[\u007f-\uffff]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
fs.writeFileSync(outputPath, normalized, 'utf8');
"@
      & node -e $nodeScript $Path $normalizedPath | Out-Null
      try {
        return (Get-Content -LiteralPath $normalizedPath -Raw | ConvertFrom-Json)
      } finally {
        Remove-Item -LiteralPath $normalizedPath -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Write-ServerLog ("Node JSON normalization fallback failed for {0}: {1}" -f $Path, $_.Exception.Message)
      throw
    }
  }
}

function Write-JsonFile {
  param(
    [string]$Path,
    $Data
  )
  $json = $Data | ConvertTo-Json -Depth 100
  if ([string]::IsNullOrWhiteSpace($json)) {
    $json = "{}"
  }
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function Sanitize-Text {
  param([AllowNull()][string]$Text)
  if ($null -eq $Text) { return "" }
  $value = $Text -replace "[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]", " "
  $value = $value -replace [string][char]0x2028, " "
  $value = $value -replace [string][char]0x2029, " "
  $value = $value -replace "[^\u0009\u000A\u000D\u0020-\u007E]", " "
  $value = $value -replace "\s{2,}", " "
  return $value.Trim()
}

function Ensure-Store {
  Protect-StoreSize
  if (-not (Test-Path $StorePath)) {
    Write-JsonFile -Path $StorePath -Data (New-SeedStore)
  }
}

function Get-DefaultRuleConfig {
  return @{
    risk = @{
      red = @("quit","delete","refund","scam","cheat")
      orange = @("nerf","unbalanced","lag","toxic","impossible")
      green = @("guide","help","best")
    }
    sentiment = @{
      negativePhrases = @("!!!","FUCK","SICK")
      positive = @("love","thanks","awesome")
    }
    taxonomy = @(
      @{ key = "matchmaking"; label = "Matchmaking"; aliases = @("queue","ranked","matchmaking","premade","mmr","match") }
      @{ key = "economy"; label = "Economy"; aliases = @("resource","gold","price","economy","reward","currency") }
      @{ key = "monetization"; label = "Monetization"; aliases = @("gacha","banner","shop","spend","pity","monetization","cash") }
      @{ key = "event"; label = "Event"; aliases = @("event","anniversary","limited","calendar","festival") }
      @{ key = "progression"; label = "Progression"; aliases = @("grind","xp","level","progression","farm","upgrade") }
      @{ key = "balance"; label = "Balance"; aliases = @("balance","meta","nerf","buff","op","underpowered") }
      @{ key = "server"; label = "Server"; aliases = @("lag","disconnect","server","ping","rubber band","latency") }
      @{ key = "bug"; label = "Bug"; aliases = @("bug","crash","broken","stuck","glitch","issue") }
      @{ key = "anti-cheat"; label = "Anti-Cheat"; aliases = @("hack","cheat","bot","aimbot","exploit") }
    )
  }
}

function Remove-DisabledTaxonomyEntries {
  param($Taxonomy)
  return @(
    @($Taxonomy) | Where-Object {
      $_.key -and $_.key -notin @("social", "onboarding")
    }
  )
}

function Get-RuleConfig {
  Ensure-Store
  if ($script:RuleConfigCache) {
    return $script:RuleConfigCache
  }
  $store = Read-JsonFile -Path $StorePath
  $defaultRules = Get-DefaultRuleConfig
  if (-not $store.rule_config) {
    if ($store.PSObject.Properties.Name -contains "rule_config") {
      $store.rule_config = $defaultRules
    } else {
      $store | Add-Member -NotePropertyName "rule_config" -NotePropertyValue $defaultRules
    }
    Write-JsonFile -Path $StorePath -Data $store
  } else {
    if (-not $store.rule_config.risk) {
      $store.rule_config | Add-Member -NotePropertyName "risk" -NotePropertyValue $defaultRules.risk -Force
    }
    if (-not $store.rule_config.sentiment) {
      $store.rule_config | Add-Member -NotePropertyName "sentiment" -NotePropertyValue $defaultRules.sentiment -Force
    }
    if (-not $store.rule_config.taxonomy) {
      $store.rule_config | Add-Member -NotePropertyName "taxonomy" -NotePropertyValue $defaultRules.taxonomy -Force
    }
    $store.rule_config.taxonomy = Remove-DisabledTaxonomyEntries -Taxonomy $store.rule_config.taxonomy
    Write-JsonFile -Path $StorePath -Data $store
  }
  $store.rule_config.taxonomy = Remove-DisabledTaxonomyEntries -Taxonomy $store.rule_config.taxonomy
  $script:RuleConfigCache = $store.rule_config
  return $script:RuleConfigCache
}

function Invalidate-StoreCache {
  $script:DatasetCache = $null
  $script:DatasetCacheStamp = ""
}

function Invoke-MemoryCleanup {
  try {
    if ([System.Runtime.GCSettings].GetProperty("LargeObjectHeapCompactionMode")) {
      [System.Runtime.GCSettings]::LargeObjectHeapCompactionMode = [System.Runtime.GCLargeObjectHeapCompactionMode]::CompactOnce
    }
  } catch {
  }

  try {
    [System.GC]::Collect([System.GC]::MaxGeneration, [System.GCCollectionMode]::Forced, $true, $true)
    [System.GC]::WaitForPendingFinalizers()
    [System.GC]::Collect([System.GC]::MaxGeneration, [System.GCCollectionMode]::Forced, $true, $true)
  } catch {
  }
}

function Get-StoreCacheStamp {
  if (-not (Test-Path $StorePath)) {
    return "missing"
  }
  return ([System.IO.File]::GetLastWriteTimeUtc($StorePath).Ticks.ToString())
}

function New-SeedStore {
  return @{
    meta = @{ lastSyncAt = $null; game = "Project Vanguard" }
    raw_posts = @()
    analyzed_feedback = @()
    risk_daily_snapshot = @()
    alerts = @()
    review_labels = @()
    daily_reports = @()
    rule_config = Get-DefaultRuleConfig
  }
}

function Protect-StoreSize {
  if (-not (Test-Path $StorePath)) {
    return
  }

  $fileInfo = Get-Item -LiteralPath $StorePath -ErrorAction SilentlyContinue
  if (-not $fileInfo -or $fileInfo.Length -lt $MaxStoreBytes) {
    return
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupPath = Join-Path $DataDir "store.oversized-$timestamp.json.bak"
  try {
    Move-Item -LiteralPath $StorePath -Destination $backupPath -Force
    Write-ServerLog "Oversized store rotated to $backupPath (size=$($fileInfo.Length))"
  } catch {
    Write-ServerLog "Oversized store rotation failed: $($_.Exception.Message)"
    Remove-Item -LiteralPath $StorePath -Force -ErrorAction SilentlyContinue
  }

  Invoke-MemoryCleanup
  Write-JsonFile -Path $StorePath -Data (New-SeedStore)
  Invalidate-StoreCache
}

function Get-LiveAnalysisItems {
  param($Store)
  $items = foreach ($raw in $Store.raw_posts) {
    $topicMatch = Get-TopicMatch -Text (Get-DirectTopicText -RawPost $raw)
    $topic = if ($topicMatch) { $topicMatch.key } else { "other" }
    $sentiment = Get-Sentiment -Text $raw.combined_text
    $riskLevel = Get-ContentRiskLevel -Text $raw.combined_text
    $impact = [Math]::Round([Math]::Min(1, (($raw.score + ($raw.comments_count * 2)) / 500.0)), 2)
    $review = $Store.review_labels | Where-Object { $_.postId -eq $raw.external_id } | Select-Object -First 1
    $resolvedTopicKey = if ($review.corrected_topic_key) { $review.corrected_topic_key } else { $topic }
    $resolvedSentiment = if ($review.corrected_sentiment) { $review.corrected_sentiment } else { $sentiment }
    [pscustomobject]@{
      external_id = $raw.external_id
      topic_key = $resolvedTopicKey
      topic_match_alias = if ($topicMatch) { $topicMatch.alias } else { $null }
      sentiment = $resolvedSentiment
      impact = $impact
      root_cause_summary = ""
      action_suggestion = ""
      risk_score = Get-RiskScoreFromLevel -RiskLevel $riskLevel
      risk_level = $riskLevel
      ignored = [bool]$review.ignored
    }
  }
  return @($items)
}

function Get-TopicTaxonomy {
  $rules = Get-RuleConfig
  if ($rules.taxonomy) {
    return @($rules.taxonomy)
  }
  return @((Get-DefaultRuleConfig).taxonomy)
}

function Decode-Literal {
  param([string]$Text)
  return [System.Text.RegularExpressions.Regex]::Unescape($Text)
}

function Get-TopicLabelZh {
  param([string]$TopicKey)
  $map = @{
    "matchmaking" = (Decode-Literal '\u5339\u914d')
    "economy" = (Decode-Literal '\u7ecf\u6d4e')
    "monetization" = (Decode-Literal '\u4ed8\u8d39')
    "event" = (Decode-Literal '\u6d3b\u52a8')
    "progression" = (Decode-Literal '\u8fdb\u5ea6')
    "balance" = (Decode-Literal '\u5e73\u8861')
    "server" = (Decode-Literal '\u670d\u52a1\u5668')
    "bug" = 'Bug'
    "anti-cheat" = (Decode-Literal '\u53cd\u4f5c\u5f0a')
    "social" = (Decode-Literal '\u793e\u4ea4')
    "onboarding" = (Decode-Literal '\u65b0\u624b\u5f15\u5bfc')
  }
  return $map[$TopicKey]
}

function Get-TopicFocusLabel {
  param([string]$TopicKey)
  $map = @{
    "monetization" = (Decode-Literal '\u4ed8\u8d39\u4ef7\u503c\u548c\u4ef7\u683c\u611f\u77e5')
    "matchmaking" = (Decode-Literal '\u5339\u914d\u516c\u5e73\u6027\u548c\u5bf9\u5c40\u8d28\u91cf')
    "server" = (Decode-Literal '\u8fde\u63a5\u7a33\u5b9a\u6027\u548c\u9ad8\u5cf0\u65f6\u6bb5\u4f53\u9a8c')
    "balance" = (Decode-Literal '\u7248\u672c\u5f3a\u5ea6\u548c\u5e73\u8861\u8282\u594f')
    "anti-cheat" = (Decode-Literal '\u7ade\u6280\u73af\u5883\u548c\u4f5c\u5f0a\u5904\u7406')
    "onboarding" = (Decode-Literal '\u65b0\u624b\u7406\u89e3\u6210\u672c\u548c\u65e9\u671f\u7559\u5b58')
    "economy" = (Decode-Literal '\u8d44\u6e90\u6295\u5165\u4ea7\u51fa\u548c\u517b\u6210\u56de\u62a5')
    "event" = (Decode-Literal '\u6d3b\u52a8\u8282\u594f\u3001\u5956\u52b1\u548c\u5ba3\u4f20\u9884\u671f')
    "progression" = (Decode-Literal '\u6210\u957f\u7ebf\u538b\u529b\u548c\u517b\u6210\u95e8\u69db')
    "bug" = (Decode-Literal '\u529f\u80fd\u5f02\u5e38\u548c\u6d41\u7a0b\u5931\u6548')
    "social" = (Decode-Literal '\u8054\u76df\u4e92\u52a8\u548c\u793e\u4ea4\u4f53\u9a8c')
  }
  return $map[$TopicKey]
}

function Get-TopicAliasesByKey {
  param([string]$TopicKey)
  $topic = @(Get-TopicTaxonomy) | Where-Object { $_.key -eq $TopicKey } | Select-Object -First 1
  if ($topic -and $topic.aliases) {
    return @($topic.aliases)
  }
  return @()
}

function Test-TopicAliasMatch {
  param(
    [string]$TopicKey,
    [string]$Alias,
    [string]$Text
  )

  if ([string]::IsNullOrWhiteSpace($Alias) -or [string]::IsNullOrWhiteSpace($Text)) {
    return $false
  }

  $normalizedAlias = $Alias.ToLowerInvariant()
  $lower = $Text.ToLowerInvariant()
  if ($normalizedAlias -eq 'op') {
    return $false
  }

  if ($TopicKey -eq 'bug' -and $normalizedAlias -eq 'issue') {
    $issuePattern = '((?<![a-z0-9])(issue|issues)(?![a-z0-9])\s+(with|when|after|on|in|causing|caused|stops?|stopped|fails?|failed|won''t|cant|can''t|cannot|bugged))|((login|server|march|forge|weapon|screen|quest|peacekeeping|client|ui|account)\s+(issue|issues))'
    return [bool]($lower -match $issuePattern)
  }

  $pattern = '(?<![a-z0-9])' + [regex]::Escape($normalizedAlias) + '(?![a-z0-9])'
  return [bool]($lower -match $pattern)
}

function Get-TopicSignalSummary {
  param(
    [string]$TopicKey,
    [object[]]$RawPosts
  )

  $signals = @{}
  foreach ($alias in (Get-TopicAliasesByKey -TopicKey $TopicKey)) {
    $normalizedAlias = ([string]$alias).ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($normalizedAlias) -or $normalizedAlias -eq 'op') {
      continue
    }
    $signals[$normalizedAlias] = 0
  }

  foreach ($raw in @($RawPosts)) {
    $directText = Get-DirectTopicText -RawPost $raw
    foreach ($alias in @($signals.Keys)) {
      if (Test-TopicAliasMatch -TopicKey $TopicKey -Alias $alias -Text $directText) {
        $signals[$alias] += 1
      }
    }
  }

  $topSignals = @(
    $signals.GetEnumerator() |
      Where-Object { $_.Value -gt 0 } |
      Sort-Object -Property @{Expression='Value';Descending=$true}, @{Expression='Name';Descending=$false} |
      Select-Object -First 3 |
      ForEach-Object { $_.Name }
  )

  if ($topSignals.Count -eq 0) {
    return ''
  }

  return ($topSignals -join (Decode-Literal '\u3001'))
}

function Get-DynamicTopicRootCause {
  param(
    [string]$TopicKey,
    [string]$RiskLevel,
    [object[]]$RawPosts
  )

  $count = @($RawPosts).Count
  $label = Get-TopicLabelZh -TopicKey $TopicKey
  if ([string]::IsNullOrWhiteSpace($label)) {
    $label = $TopicKey
  }
  $focus = Get-TopicFocusLabel -TopicKey $TopicKey
  $signalText = Get-TopicSignalSummary -TopicKey $TopicKey -RawPosts $RawPosts
  $submissionCount = @($RawPosts | Where-Object { $_.post_type -eq 'submission' }).Count
  $commentCount = @($RawPosts | Where-Object { $_.post_type -eq 'comment' }).Count

  $focusSentence = if ($signalText) {
    Decode-Literal "$label\u76f8\u5173\u53cd\u9988\u4e3b\u8981\u805a\u7126\u5728$signalText\uff0c\u6838\u5fc3\u6307\u5411$focus\u3002"
  } else {
    Decode-Literal "$label\u76f8\u5173\u53cd\u9988\u4e3b\u8981\u6307\u5411$focus\u3002"
  }

  $spreadSentence = if ($submissionCount -gt 0 -and $commentCount -gt 0) {
    Decode-Literal '\u8be5\u95ee\u9898\u540c\u65f6\u51fa\u73b0\u5728\u539f\u5e16\u548c\u8bc4\u8bba\u4e2d\uff0c\u8ba8\u8bba\u6b63\u5728\u6269\u6563\u3002'
  } elseif ($submissionCount -gt 0) {
    Decode-Literal '\u8be5\u95ee\u9898\u4ee5\u539f\u5e16\u76f4\u63a5\u53cd\u9988\u4e3a\u4e3b\u3002'
  } else {
    Decode-Literal '\u8be5\u95ee\u9898\u76ee\u524d\u4e3b\u8981\u5728\u8bc4\u8bba\u533a\u88ab\u6301\u7eed\u63d0\u53ca\u3002'
  }

  $riskSentence = switch ($RiskLevel) {
    'red' { Decode-Literal '\u5f53\u524d\u5df2\u8fdb\u5165\u9ad8\u98ce\u9669\u533a\u95f4\u3002' }
    'orange' { Decode-Literal '\u5f53\u524d\u5904\u4e8e\u91cd\u70b9\u89c2\u5bdf\u533a\u95f4\u3002' }
    default { Decode-Literal '\u5f53\u524d\u4ecd\u5c5e\u4e8e\u5e38\u89c4\u89c2\u5bdf\u9636\u6bb5\u3002' }
  }

  return "$focusSentence$spreadSentence$riskSentence"
}

function Get-DynamicActionSuggestion {
  param(
    [string]$TopicKey,
    [string]$RiskLevel,
    [object[]]$RawPosts
  )

  $focus = Get-TopicFocusLabel -TopicKey $TopicKey
  $signalText = Get-TopicSignalSummary -TopicKey $TopicKey -RawPosts $RawPosts
  $target = if ($signalText) { Decode-Literal "$signalText \u76f8\u5173\u95ee\u9898" } else { $focus }

  switch ($RiskLevel) {
    'red' {
      return Decode-Literal "\u5efa\u8bae\u7acb\u5373\u6838\u5bf9${target}\u7684\u771f\u5b9e\u5f71\u54cd\u8303\u56f4\uff0c\u6574\u7406\u53d7\u5f71\u54cd\u73a9\u5bb6\u573a\u666f\uff0c\u5e76\u5c3d\u5feb\u51c6\u5907\u5bf9\u5916\u8bf4\u660e\u3001\u4fee\u590d\u8282\u594f\u6216\u8865\u507f\u53e3\u5f84\u3002"
    }
    'orange' {
      return Decode-Literal "\u5efa\u8bae\u4f18\u5148\u590d\u76d8${target}\u7684\u53cd\u9988\u6765\u6e90\uff0c\u786e\u8ba4\u662f\u5426\u9700\u8981\u8c03\u4f18\u914d\u7f6e\u3001\u8865\u5145\u8bf4\u660e\uff0c\u6216\u63d0\u524d\u51c6\u5907\u8fd0\u8425\u56de\u5e94\u3002"
    }
    default {
      return Decode-Literal "\u5efa\u8bae\u6301\u7eed\u6536\u96c6${target}\u7684\u65b0\u589e\u53cd\u9988\uff0c\u7ed3\u5408\u540e\u7eed\u5e16\u5b50\u91cf\u548c\u70ed\u5ea6\u53d8\u5316\u5224\u65ad\u662f\u5426\u9700\u8981\u5347\u7ea7\u5904\u7406\u3002"
    }
  }
}
function Get-ActionSuggestion {
  param(
    [string]$TopicKey,
    [string]$RiskLevel,
    [int]$Volume
  )
  $urgency = switch ($RiskLevel) {
    "red" { "Immediately" }
    "orange" { "Today" }
    default { "This cycle" }
  }

  $map = @{
    "monetization" = "$urgency align on external messaging for pity, pricing, and compensation boundaries."
    "matchmaking" = "$urgency review queue quality and reset tuning, then prepare a status update for players."
    "server" = "$urgency verify capacity and reconnect stability before the next activity peak."
    "balance" = "$urgency summarize the most criticized changes and decide between hotfix or observation."
    "anti-cheat" = "$urgency prepare visible enforcement examples to rebuild trust in ranked integrity."
    "onboarding" = "$urgency publish a starter guide or FAQ that closes the biggest early-game confusion gaps."
    "economy" = "$urgency review daily reward pacing and confirm whether a short-term adjustment is needed."
    "event" = "$urgency clarify event value and timing expectations before dissatisfaction spreads further."
    "progression" = "$urgency isolate the biggest grind pain points and confirm whether progression gates should ease."
    "bug" = "$urgency communicate known issues and expected fix timing to reduce uncertainty."
    "social" = "$urgency identify the weakest social touchpoints and prioritize one near-term improvement."
  }

  if ($map.ContainsKey($TopicKey)) { return $map[$TopicKey] }
  return "$urgency review $Volume related items and confirm the next operator action."
}

function Get-Sentiment {
  param([string]$Text)
  $rules = Get-RuleConfig
  $lower = $Text.ToLowerInvariant()
  foreach ($phrase in @($rules.sentiment.negativePhrases)) {
    if ($phrase -eq "!!!" -and $Text -match '!{3,}') { return "negative" }
    if ($phrase -ne "!!!" -and $Text -cmatch ("\b" + [regex]::Escape($phrase) + "\b")) { return "negative" }
  }
  foreach ($word in @($rules.sentiment.positive)) {
    if ($lower -match ("\b" + [regex]::Escape($word.ToLowerInvariant()) + "\b")) { return "positive" }
  }
  return "neutral"
}

function Get-Topic {
  param([string]$Text)
  $match = Get-TopicMatch -Text $Text
  if ($match) {
    return $match.key
  }
  return "other"
}

function Get-DirectTopicText {
  param($RawPost)

  if (-not $RawPost) {
    return ""
  }

  if ($RawPost.post_type -eq "comment") {
    return Sanitize-Text ([string]$RawPost.body)
  }

  return Sanitize-Text ("$($RawPost.title) $($RawPost.body)")
}

function Get-TopicMatch {
  param([string]$Text)
  foreach ($topic in (Get-TopicTaxonomy)) {
    foreach ($alias in $topic.aliases) {
      $normalizedAlias = [string]$alias
      if ([string]::IsNullOrWhiteSpace($normalizedAlias)) {
        continue
      }
      $normalizedAlias = $normalizedAlias.ToLowerInvariant()
      if (Test-TopicAliasMatch -TopicKey $topic.key -Alias $normalizedAlias -Text $Text) {
        return [pscustomobject]@{
          key = $topic.key
          alias = $normalizedAlias
        }
      }
    }
  }
  return $null
}

function Get-RiskLevel {
  param([int]$Score)
  if ($Score -ge 80) { return "red" }
  if ($Score -ge 50) { return "orange" }
  return "green"
}

function Get-RiskPriority {
  param([string]$RiskLevel)
  switch ($RiskLevel) {
    "red" { return 3 }
    "orange" { return 2 }
    default { return 1 }
  }
}

function Get-RiskScoreFromLevel {
  param([string]$RiskLevel)
  switch ($RiskLevel) {
    "red" { return 90 }
    "orange" { return 65 }
    default { return 25 }
  }
}

function Get-RiskDisplayCopy {
  param([string]$RiskLevel)
  switch ($RiskLevel) {
    "red" { return "Immediate Intervention Required" }
    "orange" { return "Close Observation Needed" }
    default { return "Routine Feedback Collection" }
  }
}

function Get-RepresentativeRawForTopic {
  param(
    [object[]]$AnalysisItems,
    [object[]]$RawPosts
  )

  $candidates = foreach ($analysis in @($AnalysisItems | Where-Object { -not $_.ignored })) {
    $raw = $RawPosts | Where-Object { $_.external_id -eq $analysis.external_id } | Select-Object -First 1
    if (-not $raw) {
      continue
    }

    $alias = [string]$analysis.topic_match_alias
    $title = [string]$raw.title
    $body = [string]$raw.body
    $titleHasAlias = 0
    $bodyHasAlias = 0
    if (-not [string]::IsNullOrWhiteSpace($alias)) {
      $pattern = "(?<![a-z0-9])" + [regex]::Escape($alias.ToLowerInvariant()) + "(?![a-z0-9])"
      if ($title.ToLowerInvariant() -match $pattern) { $titleHasAlias = 1 }
      if ($body.ToLowerInvariant() -match $pattern) { $bodyHasAlias = 1 }
    }

    [pscustomobject]@{
      raw = $raw
      isSubmission = if ($raw.post_type -eq "submission") { 1 } else { 0 }
      titleHasAlias = $titleHasAlias
      bodyHasAlias = $bodyHasAlias
      hasAlias = if ([string]::IsNullOrWhiteSpace($alias)) { 0 } else { 1 }
      riskPriority = Get-RiskPriority -RiskLevel $analysis.risk_level
      impact = [double]$analysis.impact
      commentsCount = [int]$raw.comments_count
      score = [int]$raw.score
      createdAt = try { [datetime]$raw.created_at_source } catch { Get-Date "2000-01-01" }
    }
  }

  $winner = $candidates |
    Sort-Object `
      @{Expression="titleHasAlias";Descending=$true}, `
      @{Expression="isSubmission";Descending=$true}, `
      @{Expression="bodyHasAlias";Descending=$true}, `
      @{Expression="hasAlias";Descending=$true}, `
      @{Expression="riskPriority";Descending=$true}, `
      @{Expression="impact";Descending=$true}, `
      @{Expression="commentsCount";Descending=$true}, `
      @{Expression="score";Descending=$true}, `
      @{Expression="createdAt";Descending=$true} |
    Select-Object -First 1

  if ($winner) {
    return $winner.raw
  }

  return $null
}

function Get-RiskIntensity {
  param([string]$RiskLevel)
  switch ($RiskLevel) {
    "red" { return 1.0 }
    "orange" { return 0.45 }
    default { return 0.08 }
  }
}

function Get-WeatherLevelFromScore {
  param([int]$Score)
  if ($Score -gt 80) { return "green" }
  if ($Score -ge 60) { return "orange" }
  return "red"
}

function Get-WeatherLabel {
  param([string]$WeatherLevel)
  switch ($WeatherLevel) {
    "green" { return "sunny" }
    "orange" { return "cloudy" }
    default { return "rainy" }
  }
}

function Get-WeatherAdvice {
  param([string]$WeatherLevel)
  switch ($WeatherLevel) {
    "green" { return "Routine Monitoring" }
    "orange" { return "Close Risk Watch" }
    default { return "Immediate Intervention Required" }
  }
}

function Get-WeightedRiskSummary {
  param([object[]]$Posts)

  $items = @($Posts | Where-Object { -not $_.ignored })
  $redCount = @($items | Where-Object { $_.riskLevel -eq "red" }).Count
  $orangeCount = @($items | Where-Object { $_.riskLevel -eq "orange" }).Count
  $greenCount = @($items | Where-Object { $_.riskLevel -eq "green" }).Count
  $discussionHeat = [int](($items | Measure-Object -Property score -Sum).Sum + ($items | Measure-Object -Property commentsCount -Sum).Sum)

  if ($items.Count -eq 0) {
    return [pscustomobject]@{
      score = 100
      weightedRisk = 0
      redCount = 0
      orangeCount = 0
      greenCount = 0
      discussionHeat = 0
    }
  }

  $weightedRisk = 0.0
  $weightBase = 0.0
  foreach ($item in $items) {
    $heatWeight = [Math]::Min(2.5, 1 + (([double]$item.score + ([double]$item.commentsCount * 2)) / 150.0))
    $impactWeight = 0.8 + [double]$item.impact
    $formatWeight = if ($item.postType -eq "submission") { 1.15 } else { 1.0 }
    $exposure = $heatWeight * $impactWeight * $formatWeight
    $weightedRisk += (Get-RiskIntensity -RiskLevel $item.riskLevel) * $exposure
    $weightBase += $exposure
  }

  $averageRisk = if ($weightBase -gt 0) { $weightedRisk / $weightBase } else { 0.0 }
  $concentrationPenalty = [Math]::Min(15, ($redCount * 2.5) + ($orangeCount * 0.6))
  $score = [int][Math]::Round([Math]::Max(0, [Math]::Min(100, ((1 - $averageRisk) * 100) - $concentrationPenalty + 8)))

  return [pscustomobject]@{
    score = $score
    weightedRisk = [Math]::Round($averageRisk, 4)
    redCount = $redCount
    orangeCount = $orangeCount
    greenCount = $greenCount
    discussionHeat = $discussionHeat
  }
}

function Get-ContentRiskLevel {
  param([string]$Text)
  $rules = Get-RuleConfig
  $lower = $Text.ToLowerInvariant()
  foreach ($word in @($rules.risk.red)) {
    if ($lower -match ("\b" + [regex]::Escape($word.ToLowerInvariant()) + "\b")) { return "red" }
  }
  foreach ($word in @($rules.risk.orange)) {
    if ($lower -match ("\b" + [regex]::Escape($word.ToLowerInvariant()) + "\b")) { return "orange" }
  }
  return "green"
}

function Invoke-RedditRequest {
  param([string]$Url)
  $headers = @{ "User-Agent" = "GameFeedbackMonitor/1.0 (Windows PowerShell)" }
  return Invoke-RestMethod -Headers $headers -Uri $Url -Method Get
}

function Get-RedditFeedback {
  $sources = Read-JsonFile -Path $SourcesPath
  $postsPerSubreddit = [Math]::Min([int]$sources.limits.postsPerSubreddit, 50)
  $commentsPerPost = [int]$sources.limits.commentsPerPost
  $lookbackDays = if ($sources.lookbackDays) { [int]$sources.lookbackDays } else { 3 }
  $cutoffUtc = (Get-Date).ToUniversalTime().AddDays(-1 * $lookbackDays)
  $results = [System.Collections.Generic.List[object]]::new()

  foreach ($subreddit in $sources.subreddits) {
    $after = $null
    $reachedCutoff = $false
    $pageCount = 0

    try {
      while (-not $reachedCutoff -and $pageCount -lt 10) {
        $pageCount += 1
        $url = "https://www.reddit.com/r/$subreddit/new.json?limit=$postsPerSubreddit"
        if ($after) {
          $url += "&after=$after"
        }
        $listing = Invoke-RedditRequest -Url $url
        if (-not $listing.data.children -or $listing.data.children.Count -eq 0) {
          break
        }

        foreach ($child in $listing.data.children) {
          $post = $child.data
          $postCreatedUtc = [DateTimeOffset]::FromUnixTimeSeconds([int64]$post.created_utc).UtcDateTime
          if ($postCreatedUtc -lt $cutoffUtc) {
            $reachedCutoff = $true
            continue
          }

          $postTitle = Sanitize-Text ([string]$post.title)
          $postBody = Sanitize-Text ([string]$post.selftext)
          $combinedText = Sanitize-Text "$postTitle $postBody"
          $results.Add([pscustomobject]@{
            external_id = "t3_$($post.id)"
            parent_id = $null
            platform = "reddit"
            subreddit = $subreddit
            post_type = "submission"
            title = $postTitle
            body = $postBody
            author_name = (Sanitize-Text ([string]$post.author))
            score = [int]$post.score
            comments_count = [int]$post.num_comments
            post_url = "https://www.reddit.com$($post.permalink)"
            created_at_source = $postCreatedUtc.ToString("o")
            combined_text = $combinedText.Trim()
          })

          try {
            $commentResponse = Invoke-RedditRequest -Url "https://www.reddit.com$($post.permalink).json?limit=$commentsPerPost&depth=1"
            $commentListing = $commentResponse[1]
            $counter = 0
            foreach ($commentChild in $commentListing.data.children) {
              if ($commentChild.kind -ne "t1") { continue }
              if ($counter -ge $commentsPerPost) { break }
              $comment = $commentChild.data
              if ([string]::IsNullOrWhiteSpace($comment.body)) { continue }
              $commentCreatedUtc = [DateTimeOffset]::FromUnixTimeSeconds([int64]$comment.created_utc).UtcDateTime
              if ($commentCreatedUtc -lt $cutoffUtc) { continue }
              $commentBody = Sanitize-Text ([string]$comment.body)
              if ([string]::IsNullOrWhiteSpace($commentBody)) { continue }
              $counter += 1
              $results.Add([pscustomobject]@{
                external_id = "t1_$($comment.id)"
                parent_id = "t3_$($post.id)"
                platform = "reddit"
                subreddit = $subreddit
                post_type = "comment"
                title = $postTitle
                body = $commentBody
                author_name = (Sanitize-Text ([string]$comment.author))
                score = [int]$comment.score
                comments_count = 0
                post_url = "https://www.reddit.com$($post.permalink)$($comment.id)"
                created_at_source = $commentCreatedUtc.ToString("o")
                combined_text = (Sanitize-Text "$postTitle $commentBody")
              })
            }
          } catch {
          }
        }

        $after = $listing.data.after
        if (-not $after) {
          break
        }
      }
    } catch {
      continue
    }
  }

  return @($results)
}

function Sync-FeedbackStore {
  Ensure-Store
  Invoke-MemoryCleanup
  $store = Read-JsonFile -Path $StorePath
  $sources = Read-JsonFile -Path $SourcesPath
  $feedback = Get-RedditFeedback
  $today = (Get-Date).ToString("yyyy-MM-dd")
  $taxonomy = Get-TopicTaxonomy
  $lookbackDays = if ($sources.lookbackDays) { [int]$sources.lookbackDays } else { 3 }
  $cutoffUtc = (Get-Date).ToUniversalTime().AddDays(-1 * $lookbackDays)
  $freshRawPosts = [System.Collections.Generic.Dictionary[string, object]]::new()
  foreach ($item in $feedback) {
    if (-not $freshRawPosts.ContainsKey($item.external_id)) {
      $freshRawPosts[$item.external_id] = $item
    }
  }
  $store.raw_posts = @(
    $freshRawPosts.Values |
      Where-Object {
        try {
          ([datetime]$_.created_at_source).ToUniversalTime() -ge $cutoffUtc
        } catch {
          $false
        }
      } |
      Sort-Object created_at_source -Descending
  )

  $validIds = @($store.raw_posts | ForEach-Object { $_.external_id })
  $validIdSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$validIds)
  $store.review_labels = @($store.review_labels | Where-Object { $validIdSet.Contains([string]$_.postId) })

  $analysisList = [System.Collections.Generic.List[object]]::new()
  foreach ($item in $store.raw_posts) {
    $topicMatch = Get-TopicMatch -Text (Get-DirectTopicText -RawPost $item)
    $topic = if ($topicMatch) { $topicMatch.key } else { "other" }
    $sentiment = Get-Sentiment -Text $item.combined_text
    $impact = [Math]::Min(1, (($item.score + ($item.comments_count * 2)) / 500.0))
    $contentRiskLevel = Get-ContentRiskLevel -Text $item.combined_text
    $analysisList.Add([pscustomobject]@{
      external_id = $item.external_id
      raw_post_id = $item.external_id
      topic_key = $topic
      topic_match_alias = if ($topicMatch) { $topicMatch.alias } else { $null }
      sentiment = $sentiment
      impact = [Math]::Round($impact, 2)
      root_cause_summary = ""
      action_suggestion = ""
      risk_score = Get-RiskScoreFromLevel -RiskLevel $contentRiskLevel
      risk_level = $contentRiskLevel
      analyzed_at = (Get-Date).ToString("o")
    })
  }
  $store.analyzed_feedback = @($analysisList)

  $snapshots = @()
  foreach ($topic in $taxonomy) {
    $topicRaw = @($store.raw_posts | Where-Object { $_.combined_text -and $_.subreddit -in $sources.subreddits })
    $topicAnalysis = @($store.analyzed_feedback | Where-Object { $_.topic_key -eq $topic.key })
    if ($topicAnalysis.Count -eq 0) { continue }
    $negativeItems = @($topicAnalysis | Where-Object { $_.sentiment -eq "negative" })
    $topicRawIds = $topicAnalysis.external_id
    $heatItems = @($store.raw_posts | Where-Object { $topicRawIds -contains $_.external_id })
    $heat = [int](($heatItems | Measure-Object -Property score -Sum).Sum + (($heatItems | Measure-Object -Property comments_count -Sum).Sum))
    $negativeVolume = $negativeItems.Count
    $previous = @($store.risk_daily_snapshot | Where-Object { $_.topic_key -eq $topic.key } | Select-Object -Last 7)
    $baseline = if ($previous.Count -gt 0) { [Math]::Max(1, [int](($previous | Measure-Object -Property negative_volume -Average).Average)) } else { [Math]::Max(1, $negativeVolume) }
    $growth = [Math]::Round((($negativeVolume - $baseline) / [double]$baseline), 4)
    $highImpactCount = @($negativeItems | Where-Object { $_.impact -ge 0.65 }).Count
    $topicRiskLevel = "green"
    if (@($topicAnalysis | Where-Object { $_.risk_level -eq "red" }).Count -gt 0) {
      $topicRiskLevel = "red"
    } elseif (@($topicAnalysis | Where-Object { $_.risk_level -eq "orange" }).Count -gt 0) {
      $topicRiskLevel = "orange"
    }
    $riskScore = Get-RiskScoreFromLevel -RiskLevel $topicRiskLevel
    $riskLevel = $topicRiskLevel
    $dynamicRootCause = Get-DynamicTopicRootCause -TopicKey $topic.key -RiskLevel $riskLevel -RawPosts $heatItems
    $dynamicActionSuggestion = Get-DynamicActionSuggestion -TopicKey $topic.key -RiskLevel $riskLevel -RawPosts $heatItems

    foreach ($entry in $topicAnalysis) {
      $entry.risk_score = $riskScore
      $entry.risk_level = $riskLevel
      $entry.root_cause_summary = $dynamicRootCause
      $entry.action_suggestion = $dynamicActionSuggestion
    }

    $snapshots += [pscustomobject]@{
      snapshot_date = $today
      topic_key = $topic.key
      topic_label = $topic.label
      negative_volume = $negativeVolume
      negative_growth = $growth
      discussion_heat = $heat
      high_impact_count = $highImpactCount
      risk_score = $riskScore
      risk_level = $riskLevel
    }
  }

  $historyCutoff = (Get-Date).AddDays(-30).ToString("yyyy-MM-dd")
  $store.risk_daily_snapshot = @($store.risk_daily_snapshot | Where-Object { $_.snapshot_date -ge $historyCutoff -and $_.snapshot_date -ne $today }) + $snapshots

  $alerts = @()
  foreach ($snapshot in ($snapshots | Sort-Object risk_score -Descending)) {
    if ($snapshot.risk_level -eq "red" -or $snapshot.risk_level -eq "orange") {
      $representativeAnalysis = $store.analyzed_feedback |
        Where-Object { $_.topic_key -eq $snapshot.topic_key -and $_.sentiment -eq "negative" } |
        Sort-Object `
          @{Expression={Get-RiskPriority -RiskLevel $_.risk_level};Descending=$true}, `
          @{Expression="impact";Descending=$true} |
        Select-Object -First 1
      $representativeRaw = if ($representativeAnalysis) { $store.raw_posts | Where-Object { $_.external_id -eq $representativeAnalysis.external_id } | Select-Object -First 1 } else { $null }
      $topicAnalysisForAlert = @($store.analyzed_feedback | Where-Object { $_.topic_key -eq $snapshot.topic_key })
      $topicRawForAlert = @($store.raw_posts | Where-Object { $topicAnalysisForAlert.external_id -contains $_.external_id })
      $triggerReason = if ($snapshot.risk_level -eq "red") { "Critical keywords indicate boycott, refund, quit, scam, or exploit risk." } else { "Warning keywords indicate balance, whale, or nerf driven dissatisfaction." }
      $representativePostUrl = if ($representativeRaw) { $representativeRaw.post_url } else { "" }
      $deliveryChannel = if ($snapshot.risk_level -eq "red") { "Feishu + WeCom" } else { "Dashboard + Feishu" }
      $alerts += [pscustomobject]@{
        alert_id = "alert-$($snapshot.topic_key)-$today"
        snapshot_date = $today
        topic_key = $snapshot.topic_key
      topic_label = $snapshot.topic_label
      risk_level = $snapshot.risk_level
      trigger_reason = $triggerReason
      representative_post_url = $representativePostUrl
      root_cause_summary = $((Get-DynamicTopicRootCause -TopicKey $snapshot.topic_key -RiskLevel $snapshot.risk_level -RawPosts $topicRawForAlert))
      action_suggestion = $((Get-DynamicActionSuggestion -TopicKey $snapshot.topic_key -RiskLevel $snapshot.risk_level -RawPosts $topicRawForAlert))
      owner_name = "Overseas Ops"
      delivery_channel = $deliveryChannel
      delivered_at = $null
    }
    }
  }

  $store.alerts = @($store.alerts | Where-Object { $_.snapshot_date -ge $historyCutoff -and $_.snapshot_date -ne $today }) + $alerts
  $topAlert = $alerts | Sort-Object { $_.risk_level } -Descending | Select-Object -First 1
  $dailyExecutiveSummary = if ($topAlert) { "$($topAlert.topic_label) is the primary player-risk area today." } else { "No major player-risk spike today." }
  $store.daily_reports = @($store.daily_reports | Where-Object { $_.report_date -ge $historyCutoff -and $_.report_date -ne $today }) + @(
    [pscustomobject]@{
      report_date = $today
      executive_summary = $dailyExecutiveSummary
      report_payload = @{
        generatedAt = (Get-Date).ToString("o")
      }
    }
  )

  $store.meta.lastSyncAt = (Get-Date).ToString("o")
  $store.meta.game = $sources.game.name

  Invoke-MemoryCleanup
  Write-JsonFile -Path $StorePath -Data $store
  Invalidate-StoreCache
  Invoke-MemoryCleanup
  return @{
    syncedAt = $store.meta.lastSyncAt
    ingested = $store.raw_posts.Count
    uniqueItems = $store.raw_posts.Count
    alerts = $alerts.Count
  }
}

function Get-StoreDataset {
  Ensure-Store
  $cacheStamp = Get-StoreCacheStamp
  if ($script:DatasetCache -and $script:DatasetCacheStamp -eq $cacheStamp) {
    return $script:DatasetCache
  }
  $store = Read-JsonFile -Path $StorePath
  $sources = Read-JsonFile -Path $SourcesPath
  $taxonomy = Get-TopicTaxonomy
  $today = (Get-Date).ToString("yyyy-MM-dd")
  $analysisItems = Get-LiveAnalysisItems -Store $store

  $issues = foreach ($topic in $taxonomy) {
    $analysis = @($analysisItems | Where-Object { $_.topic_key -eq $topic.key -and -not $_.ignored })
    if ($analysis.Count -eq 0) { continue }
    $negativeItems = @($analysis | Where-Object { $_.sentiment -eq "negative" })
    $raw = @($store.raw_posts | Where-Object { ($analysis.external_id) -contains $_.external_id } | Sort-Object score -Descending)
    $heat = [int](($raw | Measure-Object -Property score -Sum).Sum + ($raw | Measure-Object -Property comments_count -Sum).Sum)
    $previous = @($store.risk_daily_snapshot | Where-Object { $_.topic_key -eq $topic.key } | Sort-Object snapshot_date | Select-Object -Last 6)
    $baseline = if ($previous.Count -gt 0) { [Math]::Max(1, [int](($previous | Measure-Object -Property negative_volume -Average).Average)) } else { [Math]::Max(1, $negativeItems.Count) }
    $growth = [Math]::Round((($negativeItems.Count - $baseline) / [double]$baseline), 4)
    $highImpactCount = @($negativeItems | Where-Object { $_.impact -ge 0.65 }).Count
    $riskLevel = "green"
    if (@($analysis | Where-Object { $_.risk_level -eq "red" }).Count -gt 0) {
      $riskLevel = "red"
    } elseif (@($analysis | Where-Object { $_.risk_level -eq "orange" }).Count -gt 0) {
      $riskLevel = "orange"
    }
    $riskScore = Get-RiskScoreFromLevel -RiskLevel $riskLevel
    $trend = @($previous | ForEach-Object { [int]$_.risk_score }) + @($riskScore)
    $representativePost = Get-RepresentativeRawForTopic -AnalysisItems $analysis -RawPosts $store.raw_posts
    $dynamicRootCause = Get-DynamicTopicRootCause -TopicKey $topic.key -RiskLevel $riskLevel -RawPosts $raw
    $dynamicActionSuggestion = Get-DynamicActionSuggestion -TopicKey $topic.key -RiskLevel $riskLevel -RawPosts $raw
    [pscustomobject]@{
      key = $topic.key
      label = $topic.label
      occurrenceCount = $analysis.Count
      negativeCount = $negativeItems.Count
      negativeShare = [Math]::Round(($negativeItems.Count / [double]$analysis.Count), 2)
      heat = $heat
      growth = $growth
      trend = $trend
      riskScore = $riskScore
      riskLevel = $riskLevel
      riskCopy = Get-RiskDisplayCopy -RiskLevel $riskLevel
      rootCause = $dynamicRootCause
      actionSuggestion = $dynamicActionSuggestion
      representativePost = $representativePost
    }
  }
  $issues = @($issues | Sort-Object @{Expression={Get-RiskPriority -RiskLevel $_.riskLevel};Descending=$true}, @{Expression="heat";Descending=$true})
  $totalIssueOccurrences = [Math]::Max(1, (@($issues | Measure-Object -Property occurrenceCount -Sum).Sum))
  foreach ($issue in $issues) {
    $issue | Add-Member -NotePropertyName "riskShare" -NotePropertyValue ([Math]::Round(($issue.occurrenceCount / [double]$totalIssueOccurrences), 2)) -Force
  }
  $issueMap = @{}
  foreach ($issue in $issues) {
    $issueMap[$issue.key] = $issue
  }
  $alerts = @($store.alerts | Where-Object { $_.snapshot_date -eq $today })

  $posts = foreach ($raw in ($store.raw_posts | Sort-Object score -Descending)) {
    $analysis = $analysisItems | Where-Object { $_.external_id -eq $raw.external_id } | Select-Object -First 1
    if (-not $analysis) { continue }
    $postTitle = if ($raw.post_type -eq "comment") { "Comment on: $($raw.title)" } else { $raw.title }
    $resolvedRiskLevel = $analysis.risk_level
    $resolvedRootCause = if ($issueMap.ContainsKey($analysis.topic_key)) { $issueMap[$analysis.topic_key].rootCause } else { $analysis.root_cause_summary }
    $resolvedActionSuggestion = if ($issueMap.ContainsKey($analysis.topic_key)) { $issueMap[$analysis.topic_key].actionSuggestion } else { $analysis.action_suggestion }
    $topCommentPreview = $null
    if ($raw.post_type -eq "submission") {
      $topCommentRaw = $store.raw_posts |
        Where-Object { $_.post_type -eq "comment" -and $_.parent_id -eq $raw.external_id } |
        Sort-Object score -Descending |
        Select-Object -First 1
      if ($topCommentRaw) {
        $topCommentPreview = [pscustomobject]@{
          id = $topCommentRaw.external_id
          author = $topCommentRaw.author_name
          body = $topCommentRaw.body
          score = [int]$topCommentRaw.score
          url = $topCommentRaw.post_url
        }
      }
    }
    [pscustomobject]@{
      id = $raw.external_id
      parentId = $raw.parent_id
      postType = $raw.post_type
      subreddit = $raw.subreddit
      title = $postTitle
      originalTitle = $raw.title
      body = $raw.body
      author = $raw.author_name
      score = [int]$raw.score
      commentsCount = [int]$raw.comments_count
      createdAt = $raw.created_at_source
      url = $raw.post_url
      topic = $analysis.topic_key
      sentiment = $analysis.sentiment
      riskLevel = $resolvedRiskLevel
      riskCopy = Get-RiskDisplayCopy -RiskLevel $resolvedRiskLevel
      rootCause = $resolvedRootCause
      actionSuggestion = $resolvedActionSuggestion
      ignored = [bool]$analysis.ignored
      impact = $analysis.impact
      topCommentPreview = $topCommentPreview
    }
  }

  $topIssue = $issues | Select-Object -First 1
  $recentPosts = @(Get-RecentPosts -Posts $posts -Hours 72)
  $latestWindowCutoff = (Get-Date).ToUniversalTime().AddHours(-24)
  $baselinePosts = @($recentPosts | Where-Object { ([datetime]$_.createdAt).ToUniversalTime() -lt $latestWindowCutoff })
  $overviewSummary = Get-WeightedRiskSummary -Posts $recentPosts
  $baselineSummary = if ($baselinePosts.Count -gt 0) { Get-WeightedRiskSummary -Posts $baselinePosts } else { $overviewSummary }
  $overviewScore = $overviewSummary.score
  $overviewRiskChange = [int]($overviewScore - $baselineSummary.score)
  $overviewGrowthRate = if ($baselineSummary.score -gt 0) { [Math]::Round((($overviewScore - $baselineSummary.score) / [double][Math]::Max(1, $baselineSummary.score)), 4) } else { 0 }
  $overviewExecutiveSummary = if ($topIssue) { "$($topIssue.label) is the biggest live risk source in the last 72 hours." } else { "No major live risk is visible yet." }
  $overviewRiskLevel = Get-WeatherLevelFromScore -Score $overviewScore
  $overview = [pscustomobject]@{
    game = $sources.game.name
    sources = $sources.subreddits | ForEach-Object { "r/$_" }
    riskScore = $overviewScore
    riskLevel = $overviewRiskLevel
    weatherLevel = $overviewRiskLevel
    weatherLabel = Get-WeatherLabel -WeatherLevel $overviewRiskLevel
    needleAngle = [Math]::Round((-90 + ($overviewScore * 1.8)), 2)
    riskCopy = Get-WeatherAdvice -WeatherLevel $overviewRiskLevel
    riskChange = $overviewRiskChange
    negativeVolume = $overviewSummary.redCount
    redRiskCount = $overviewSummary.redCount
    orangeRiskCount = $overviewSummary.orangeCount
    greenRiskCount = $overviewSummary.greenCount
    discussionHeat = $overviewSummary.discussionHeat
    growthRate = $overviewGrowthRate
    alertsCount = $alerts.Count
    topTopic = $topIssue
    executiveSummary = $overviewExecutiveSummary
    lastSyncAt = $store.meta.lastSyncAt
  }

  $reportExecutiveDetail = if ($topIssue) { "$($topIssue.label) risk score is $($topIssue.riskScore). $($topIssue.rootCause)" } else { $overview.executiveSummary }
  $report = [pscustomobject]@{
    title = "$($sources.game.name) Daily Risk Brief"
    subtitle = "Sources: " + (($sources.subreddits | ForEach-Object { "r/$_" }) -join " / ")
    executiveSummary = $overview.executiveSummary
    executiveDetail = $reportExecutiveDetail
    metrics = @(
      @{ label = "Overall risk"; value = $overview.riskScore; hint = $overview.riskLevel }
      @{ label = "Negative items"; value = $overview.negativeVolume; hint = "negative submissions/comments" }
      @{ label = "Active alerts"; value = $overview.alertsCount; hint = "high-risk or accelerating topics" }
      @{ label = "Discussion heat"; value = $overview.discussionHeat; hint = "score + comments" }
    )
    topTopics = @($issues | Select-Object -First 3)
    actions = @($alerts | ForEach-Object { @{ title = "$($_.topic_label) - $($_.owner_name)"; body = "$($_.trigger_reason) $($_.action_suggestion)" } })
    featuredPosts = @($posts | Where-Object { -not $_.ignored } | Select-Object -First 4)
  }

  $reviewQueue = @($posts | Where-Object { ($_.sentiment -eq "negative" -or $_.impact -ge 0.65) -and -not $_.ignored } | Select-Object -First 20)

  $dataset = @{
    overview = $overview
    issues = $issues
    posts = $posts
    alerts = $alerts
    taxonomy = $taxonomy
    rules = Get-RuleConfig
    report = $report
    reviewQueue = $reviewQueue
    reviewActions = $store.review_labels
  }
  $script:DatasetCache = $dataset
  $script:DatasetCacheStamp = $cacheStamp
  return $dataset
}

function Get-RecentPosts {
  param(
    [object[]]$Posts,
    [int]$Hours = 72
  )

  $cutoffUtc = (Get-Date).ToUniversalTime().AddHours(-1 * $Hours)
  return @(
    @($Posts) | Where-Object {
      if ($_.ignored) {
        return $false
      }

      try {
        ([datetime]$_.createdAt).ToUniversalTime() -ge $cutoffUtc
      } catch {
        $false
      }
    }
  )
}

function Save-ReviewLabel {
  param($Body)
  $store = Read-JsonFile -Path $StorePath
  $entry = [pscustomobject]@{
    postId = $Body.postId
    corrected_topic_key = $Body.topic
    corrected_sentiment = $Body.sentiment
    ignored = [bool]$Body.ignored
    note = $Body.note
    createdAt = (Get-Date).ToString("o")
  }
  $store.review_labels = @($store.review_labels | Where-Object { $_.postId -ne $Body.postId })
  $store.review_labels += $entry
  Write-JsonFile -Path $StorePath -Data $store
  Invalidate-StoreCache
  return @{ ok = $true }
}

function Save-RuleConfig {
  param($Body)
  $store = Read-JsonFile -Path $StorePath
  $clean = [pscustomobject]@{
    risk = [pscustomobject]@{
      red = @($Body.risk.red | ForEach-Object { (Sanitize-Text ([string]$_)).ToLowerInvariant() } | Where-Object { $_ })
      orange = @($Body.risk.orange | ForEach-Object { (Sanitize-Text ([string]$_)).ToLowerInvariant() } | Where-Object { $_ })
      green = @($Body.risk.green | ForEach-Object { (Sanitize-Text ([string]$_)).ToLowerInvariant() } | Where-Object { $_ })
    }
    sentiment = [pscustomobject]@{
      negativePhrases = @($Body.sentiment.negativePhrases | ForEach-Object { Sanitize-Text ([string]$_) } | Where-Object { $_ })
      positive = @($Body.sentiment.positive | ForEach-Object { (Sanitize-Text ([string]$_)).ToLowerInvariant() } | Where-Object { $_ })
    }
    taxonomy = @($Body.taxonomy | ForEach-Object {
      [pscustomobject]@{
        key = (Sanitize-Text ([string]$_.key)).ToLowerInvariant()
        label = Sanitize-Text ([string]$_.label)
        aliases = @($_.aliases | ForEach-Object { (Sanitize-Text ([string]$_)).ToLowerInvariant() } | Where-Object { $_ })
      }
    } | Where-Object { $_.key -and $_.key -notin @("social", "onboarding") })
  }
  if ($store.PSObject.Properties.Name -contains "rule_config") {
    $store.rule_config = $clean
  } else {
    $store | Add-Member -NotePropertyName "rule_config" -NotePropertyValue $clean
  }
  Write-JsonFile -Path $StorePath -Data $store
  $script:RuleConfigCache = $clean
  Invalidate-StoreCache
  return @{ ok = $true; rules = $clean }
}

function Send-Json {
  param(
    [Parameter(Mandatory = $true)]$Context,
    [Parameter(Mandatory = $true)]$Data,
    [int]$StatusCode = 200
  )
  try {
    $json = $Data | ConvertTo-Json -Depth 100
    if ([string]::IsNullOrWhiteSpace($json)) {
      $json = "[]"
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = "application/json; charset=utf-8"
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.AddHeader("Access-Control-Allow-Origin", "*")
    $Context.Response.AddHeader("Access-Control-Allow-Headers", "Content-Type")
    $Context.Response.AddHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    Write-ServerLog "Send-Json failed: $($_.Exception.Message)"
  } finally {
    try { $Context.Response.OutputStream.Close() } catch {}
  }
}

function Send-File {
  param(
    [Parameter(Mandatory = $true)]$Context,
    [Parameter(Mandatory = $true)][string]$Path
  )
  if (-not (Test-Path $Path)) {
    Send-Json -Context $Context -Data @{ error = "Not found" } -StatusCode 404
    return
  }
  try {
    $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    $contentType = switch ($ext) {
      ".html" { "text/html; charset=utf-8" }
      ".css" { "text/css; charset=utf-8" }
      ".js" { "application/javascript; charset=utf-8" }
      ".json" { "application/json; charset=utf-8" }
      ".md" { "text/plain; charset=utf-8" }
      default { "application/octet-stream" }
    }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $Context.Response.StatusCode = 200
    $Context.Response.ContentType = $contentType
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.AddHeader("Access-Control-Allow-Origin", "*")
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    Write-ServerLog "Send-File failed for $Path : $($_.Exception.Message)"
  } finally {
    try { $Context.Response.OutputStream.Close() } catch {}
  }
}

Ensure-Store
$store = Read-JsonFile -Path $StorePath
if (-not $store.meta.lastSyncAt) {
  try { Sync-FeedbackStore | Out-Null } catch {}
}
$sourcesConfig = Read-JsonFile -Path $SourcesPath
$autoSyncIntervalMinutes = if ($sourcesConfig.syncIntervalMinutes) { [int]$sourcesConfig.syncIntervalMinutes } else { 30 }
$nextAutoSyncAt = (Get-Date).AddMinutes($autoSyncIntervalMinutes)

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Game Feedback Monitor running at http://127.0.0.1:$Port/"
Write-ServerLog "Server started on port $Port"

$pendingContext = $listener.BeginGetContext($null, $null)
while ($listener.IsListening) {
  $context = $null
  try {
    if (-not $pendingContext.AsyncWaitHandle.WaitOne(300)) {
      if ((Get-Date) -ge $nextAutoSyncAt) {
        try {
          $syncResult = Sync-FeedbackStore
          Write-ServerLog "Auto sync completed: $($syncResult.syncedAt), ingested=$($syncResult.ingested), unique=$($syncResult.uniqueItems)"
        } catch {
          Write-ServerLog "Auto sync failed: $($_.Exception.Message)"
        } finally {
          $nextAutoSyncAt = (Get-Date).AddMinutes($autoSyncIntervalMinutes)
        }
      }
      continue
    }

    $context = $listener.EndGetContext($pendingContext)
    $pendingContext = $listener.BeginGetContext($null, $null)
    $request = $context.Request
    $path = $request.Url.AbsolutePath

    if ($request.HttpMethod -eq "OPTIONS") {
      Send-Json -Context $context -Data @{ ok = $true }
      continue
    }

    if ($path -eq "/api/admin/sync" -and $request.HttpMethod -eq "POST") {
      $result = Sync-FeedbackStore
      $nextAutoSyncAt = (Get-Date).AddMinutes($autoSyncIntervalMinutes)
      Send-Json -Context $context -Data @{ ok = $true; result = $result }
      continue
    }

    if ($path -eq "/api/dashboard/overview" -and $request.HttpMethod -eq "GET") {
      Send-Json -Context $context -Data ((Get-StoreDataset).overview)
      continue
    }

    if ($path -eq "/api/dashboard" -and $request.HttpMethod -eq "GET") {
      $dataset = Get-StoreDataset
      Send-Json -Context $context -Data @{
        overview = $dataset.overview
        issues = $dataset.issues
        alerts = $dataset.alerts
        taxonomy = $dataset.taxonomy
      }
      continue
    }

    if ($path -eq "/api/issues" -and $request.HttpMethod -eq "GET") {
      $dataset = Get-StoreDataset
      $system = $request.QueryString["system"]
      $risk = $request.QueryString["risk"]
      $items = @($dataset.issues)
      if ($system -and $system -ne "all") { $items = @($items | Where-Object { $_.key -eq $system }) }
      if ($risk -and $risk -ne "all") { $items = @($items | Where-Object { $_.riskLevel -eq $risk }) }
      Send-Json -Context $context -Data $items
      continue
    }

    if ($path -eq "/api/posts" -and $request.HttpMethod -eq "GET") {
      $dataset = Get-StoreDataset
      $topic = $request.QueryString["topic"]
      $sentiment = $request.QueryString["sentiment"]
      $risk = $request.QueryString["risk"]
      $contentType = $request.QueryString["contentType"]
      $sort = $request.QueryString["sort"]
      $page = 1
      $pageSize = 10
      if (-not [int]::TryParse($request.QueryString["page"], [ref]$page)) { $page = 1 }
      if (-not [int]::TryParse($request.QueryString["pageSize"], [ref]$pageSize)) { $pageSize = 10 }
      $page = [Math]::Max(1, $page)
      $pageSize = [Math]::Min([Math]::Max(1, $pageSize), 50)

      $items = @(Get-RecentPosts -Posts $dataset.posts -Hours 72)
      if ($topic -and $topic -ne "all") { $items = @($items | Where-Object { $_.topic -eq $topic }) }
      if ($sentiment -and $sentiment -ne "all") { $items = @($items | Where-Object { $_.sentiment -eq $sentiment }) }
      if ($risk -and $risk -ne "all") { $items = @($items | Where-Object { $_.riskLevel -eq $risk }) }
      if ($contentType -and $contentType -ne "all") { $items = @($items | Where-Object { $_.postType -eq $contentType }) }

      if ($sort -eq "heat") {
        $items = @($items | Sort-Object -Descending -Property @{ Expression = { ([int]$_.score) + (([int]$_.commentsCount) * 3) } }, @{ Expression = { [datetime]$_.createdAt } })
      } else {
        $items = @($items | Sort-Object -Descending -Property @{ Expression = { [datetime]$_.createdAt } }, @{ Expression = { ([int]$_.score) + (([int]$_.commentsCount) * 3) } })
      }

      $total = @($items).Count
      $totalPages = if ($total -le 0) { 1 } else { [int][Math]::Ceiling($total / $pageSize) }
      $page = [Math]::Min($page, $totalPages)
      $skip = ($page - 1) * $pageSize
      $pagedItems = @($items | Select-Object -Skip $skip -First $pageSize)

      Send-Json -Context $context -Data @{
        items = $pagedItems
        page = $page
        pageSize = $pageSize
        total = $total
        totalPages = $totalPages
      }
      continue
    }

    if ($path -eq "/api/reports/daily" -and $request.HttpMethod -eq "GET") {
      Send-Json -Context $context -Data ((Get-StoreDataset).report)
      continue
    }

    if ($path -eq "/api/review-queue" -and $request.HttpMethod -eq "GET") {
      Send-Json -Context $context -Data ((Get-StoreDataset).reviewQueue)
      continue
    }

    if ($path -eq "/api/rules" -and $request.HttpMethod -eq "GET") {
      Send-Json -Context $context -Data ((Get-StoreDataset).rules)
      continue
    }

    if ($path -eq "/api/labels/review" -and $request.HttpMethod -eq "POST") {
      $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
      $bodyText = $reader.ReadToEnd()
      $reader.Close()
      $body = if ($bodyText) { $bodyText | ConvertFrom-Json } else { @{} }
      $result = Save-ReviewLabel -Body $body
      Send-Json -Context $context -Data $result
      continue
    }

    if ($path -eq "/api/rules" -and $request.HttpMethod -eq "POST") {
      $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
      $bodyText = $reader.ReadToEnd()
      $reader.Close()
      $body = if ($bodyText) { $bodyText | ConvertFrom-Json } else { @{} }
      $result = Save-RuleConfig -Body $body
      Send-Json -Context $context -Data $result
      continue
    }

    if ($path -eq "/api/alerts/test" -and $request.HttpMethod -eq "POST") {
      Send-Json -Context $context -Data @{ ok = $true; message = "Test alert sent to Feishu/WeCom adapter mock." }
      continue
    }

    if ($path -eq "/api/alerts" -and $request.HttpMethod -eq "GET") {
      Send-Json -Context $context -Data ((Get-StoreDataset).alerts)
      continue
    }

    $localPath = if ($path -eq "/") { Join-Path $ProjectRoot "index.html" } else { Join-Path $ProjectRoot ($path.TrimStart('/')) }
    Send-File -Context $context -Path $localPath
  } catch {
    Write-ServerLog "Request loop failed: $($_.Exception.Message)"
    if ($context) {
      try {
        Send-Json -Context $context -Data @{ error = $_.Exception.Message } -StatusCode 500
      } catch {
        Write-ServerLog "Failed to send error response: $($_.Exception.Message)"
      }
    } else {
      Start-Sleep -Milliseconds 300
    }
  }
}
