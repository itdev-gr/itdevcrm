<?php
// Repo copy of /var/www/recordings/push_stats_sales.php on the PBX box
// (72.62.58.175, ssh srv1). Cron /etc/cron.d/push-stats-sales, every 2 min.
// Pushes today's Yeastar CDR to the SALES Supabase project:
//   call_stats_daily (sales extensions only — feeds the Activity Dashboard)
//   call_records     (sales + CRM-only extensions — feeds the CRM pull-calls
//                     chain that turns calls into auto-comments on cards)
require __DIR__ . "/yeastar.php";
date_default_timezone_set("Europe/Athens");

if (!getenv("SALES_SUPABASE_URL")) {
    $envFile = "/etc/supabase-sales.env";
    if (file_exists($envFile)) {
        foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            if (str_starts_with(trim($line), "#")) continue;
            putenv(trim($line));
        }
    }
}

$SUP_URL = getenv("SALES_SUPABASE_URL");
$SUP_KEY = getenv("SALES_SUPABASE_SERVICE_ROLE_KEY");
if (!$SUP_URL || !$SUP_KEY) { fwrite(STDERR, "missing SALES_SUPABASE env\n"); exit(1); }

// Sales extensions: aggregated stats + per-call records.
$EXT = ["204","206","208","304","500","501","601"];
// CRM-only extensions: per-call records ONLY (no call_stats_daily rows), so
// the sales Activity Dashboard is untouched. Their start date blocks any
// argv backfill from pushing pre-2026-09-08 history (owner decision 2026-09-08).
$EXT_CRM_ONLY = ["101","102","103","104","203","205","207","303"];
$extStartDate = ["601" => "2026-08-25"] + array_fill_keys($EXT_CRM_ONLY, "2026-09-08");
$isExt = array_flip(array_merge($EXT, $EXT_CRM_ONLY));
$statsExt = array_flip($EXT);

// Support backfilling: php push_stats_sales.php [YYYY-MM-DD]
$dateArg = $argv[1] ?? null;
if ($dateArg && preg_match("/^\d{4}-\d{2}-\d{2}$/", $dateArg)) {
    $startTs = strtotime($dateArg . " 00:00:00");
    $endTs   = strtotime($dateArg . " 23:59:59");
    $dateStr = $dateArg;
} else {
    $startTs = strtotime("today 00:00:00");
    $endTs   = strtotime("today 23:59:59");
    $dateStr = date("Y-m-d");
}

$res = yeastar_cdr_range($startTs, $endTs);
$cdr = $res["data"] ?? [];

// Fetch recording map (filename => numeric ID) for play/download
$recMap = yeastar_recording_map($startTs, $endTs);
fwrite(STDERR, date("c") . " recordings map: " . count($recMap) . " entries\n");

function fetch_extension_map($url, $key) {
    $ch = curl_init($url . "/rest/v1/profiles?voiceland_extension=not.is.null&select=id,voiceland_extension");
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ["apikey: " . $key, "Authorization: Bearer " . $key], CURLOPT_TIMEOUT => 15]);
    $out = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($code >= 300) { fwrite(STDERR, date("c")." profiles fetch failed http=$code $out\n"); return []; }
    $map = [];
    foreach (json_decode($out, true) ?: [] as $row) { $map[$row["voiceland_extension"]] = $row["id"]; }
    return $map;
}
$extToProfile = fetch_extension_map($SUP_URL, $SUP_KEY);

function agentExt($c, $isExt) {
    $t = $c["call_type"] ?? ""; $f = $c["call_from_number"] ?? ""; $to = $c["call_to_number"] ?? "";
    if ($t === "Outbound")  return isset($isExt[$f])  ? $f  : null;
    if ($t === "Inbound")   return isset($isExt[$to]) ? $to : null;
    if ($t === "Internal")  return isset($isExt[$f])  ? $f  : null;
    return null;
}

$agg = [];
$callRows = [];
foreach ($cdr as $c) {
    $ext = agentExt($c, $isExt);
    if (!$ext) continue;
    if (isset($extStartDate[$ext])) { $ct = $c["time"] ?? ""; $cd = DateTime::createFromFormat("d/m/Y H:i:s", $ct); if ($cd && $cd->format("Y-m-d") < $extStartDate[$ext]) continue; }
    $ring = (int)($c["ring_duration"] ?? 0);
    $talk = max(0, (int)($c["duration"] ?? 0) - $ring);
    $isAns = ($c["disposition"] ?? "") === "ANSWERED";
    $type = $c["call_type"] ?? "";
    $profileId = $extToProfile[$ext] ?? null;

    if (isset($statsExt[$ext])) {
        if (!isset($agg[$ext])) $agg[$ext] = ["total"=>0,"inbound"=>0,"outbound"=>0,"internal"=>0,"answered"=>0,"missed"=>0,"talk_seconds"=>0,"ring_seconds"=>0,"nums"=>[]];
        $a =& $agg[$ext];
        $a["total"]++;
        if ($type === "Inbound") $a["inbound"]++;
        elseif ($type === "Outbound") $a["outbound"]++;
        elseif ($type === "Internal") $a["internal"]++;
        if ($isAns) $a["answered"]++; else $a["missed"]++;
        $a["talk_seconds"] += $talk;
        $a["ring_seconds"] += $ring;
        $other = ($type === "Inbound") ? ($c["call_from_number"] ?? "") : ($c["call_to_number"] ?? "");
        if ($other !== "") $a["nums"][$other] = true;
        unset($a);
    }

    $uid = $c["uid"] ?? null;
    if ($uid) {
        $ts = (int)($c["timestamp"] ?? 0);
        $callTime = $ts ? date("c", $ts) : ($c["time"] ?? date("c"));
        // Map record_file to numeric recording ID for playback
        $rf = $c["record_file"] ?? "";
        $recId = ($rf && isset($recMap[$rf])) ? (string)$recMap[$rf] : null;
        $callRows[] = [
            "extension" => $ext, "profile_id" => $profileId,
            "call_date" => $dateStr, "call_time" => $callTime,
            "call_type" => $type, "disposition" => $c["disposition"] ?? null,
            "call_from" => $c["call_from_number"] ?? null, "call_to" => $c["call_to_number"] ?? null,
            "duration_seconds" => (int)($c["duration"] ?? 0), "talk_seconds" => $talk, "ring_seconds" => $ring,
            "recording_id" => $recId, "yeastar_uid" => $uid,
        ];
    }
}

// Deduplicate by yeastar_uid
$deduped = [];
foreach ($callRows as $cr) { if (isset($cr["yeastar_uid"])) $deduped[$cr["yeastar_uid"]] = $cr; }
$callRows = array_values($deduped);

// Push aggregated stats
$statsRows = [];
foreach ($agg as $ext => $a) {
    $statsRows[] = ["extension"=>$ext,"stat_date"=>$dateStr,"profile_id"=>$extToProfile[$ext]??null,
        "total_calls"=>$a["total"],"inbound_calls"=>$a["inbound"],"outbound_calls"=>$a["outbound"],
        "internal_calls"=>$a["internal"],"answered_calls"=>$a["answered"],"missed_calls"=>$a["missed"],
        "talk_seconds"=>$a["talk_seconds"],"ring_seconds"=>$a["ring_seconds"],
        "unique_numbers"=>count($a["nums"]),"updated_at"=>date("c")];
}

function supabase_upsert($url, $key, $table, $rows, $conflict) {
    if (!$rows) return 0;
    $endpoint = $url . "/rest/v1/" . $table . "?on_conflict=" . $conflict;
    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ["apikey: ".$key, "Authorization: Bearer ".$key, "Content-Type: application/json", "Prefer: resolution=merge-duplicates,return=minimal"],
        CURLOPT_POSTFIELDS => json_encode($rows), CURLOPT_TIMEOUT => 30]);
    $out = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($code >= 300) fwrite(STDERR, date("c")." $table: ".count($rows)." rows http=$code $out\n");
    return $code;
}

supabase_upsert($SUP_URL, $SUP_KEY, "call_stats_daily", $statsRows, "extension,stat_date");

for ($i = 0; $i < count($callRows); $i += 100) {
    supabase_upsert($SUP_URL, $SUP_KEY, "call_records", array_slice($callRows, $i, 100), "yeastar_uid");
}

$recsWithId = count(array_filter($callRows, fn($r) => $r["recording_id"] !== null));
$total = count($cdr);
$pushed = count($statsRows);
$records = count($callRows);
echo date("c") . " done: $total cdr, $pushed stats, $records records ($recsWithId with recording), date=$dateStr\n";
