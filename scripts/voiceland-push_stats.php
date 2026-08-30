<?php
/** CLI: aggregate today's Yeastar CDR per extension and upsert to Supabase call_stats_daily. */
require __DIR__ . '/yeastar.php';

date_default_timezone_set('Europe/Athens');
$SUP_URL = getenv('SUPABASE_URL');
$SUP_KEY = getenv('SUPABASE_SERVICE_ROLE_KEY');
if (!$SUP_URL || !$SUP_KEY) { fwrite(STDERR, "missing SUPABASE env\n"); exit(1); }

$EXT = ['101','102','103','104','203','204','205','206','207','208','303','500','501','601'];
$isExt = array_flip($EXT);
$extStartDate = ["601" => "2026-08-25"]; // present on the box; currently unused

$startTs = strtotime('today 00:00:00');
$endTs   = strtotime('today 23:59:59');
$res = yeastar_cdr_range($startTs, $endTs);
$cdr = $res['data'] ?? [];
$today = date('Y-m-d');

// Internal calls credit BOTH extensions (caller and callee) so each side's
// talk time includes internal conversations; from==to rows credit once.
function agentExts($c, $isExt) {
    $t = $c['call_type'] ?? ''; $f = $c['call_from_number'] ?? ''; $to = $c['call_to_number'] ?? '';
    if ($t === 'Outbound')  return isset($isExt[$f])  ? [$f]  : [];
    if ($t === 'Inbound')   return isset($isExt[$to]) ? [$to] : [];
    if ($t === 'Internal') {
        $exts = [];
        if (isset($isExt[$f])) $exts[] = $f;
        if (isset($isExt[$to]) && $to !== $f) $exts[] = $to;
        return $exts;
    }
    return [];
}

$agg = [];
foreach ($cdr as $c) {
    foreach (agentExts($c, $isExt) as $ext) {
    if (!isset($agg[$ext])) $agg[$ext] = [
        'total'=>0,'inbound'=>0,'outbound'=>0,'internal'=>0,'answered'=>0,'missed'=>0,
        'missed_inbound'=>0,'talk_seconds'=>0,'ring_seconds'=>0,'nums'=>[],'recent'=>[]];
    $a =& $agg[$ext];
    $type = $c['call_type'] ?? ''; $disp = $c['disposition'] ?? '';
    $isAns = ($disp === 'ANSWERED');
    // Yeastar `duration` = total (ring+talk); `talk_duration` exists only on
    // answered calls. duration - ring_duration = talk in all cases (0 when unanswered).
    $ring = (int)($c['ring_duration'] ?? 0);
    $talk = max(0, (int)($c['duration'] ?? 0) - $ring);
    $a['total']++;
    if ($type === 'Inbound') { $a['inbound']++; if (!$isAns) $a['missed_inbound']++; }
    elseif ($type === 'Outbound') $a['outbound']++;
    elseif ($type === 'Internal') $a['internal']++;
    if ($isAns) $a['answered']++; else $a['missed']++;
    $a['talk_seconds'] += $talk;
    $a['ring_seconds'] += $ring;
    if ($type === 'Internal') $other = ($ext === ($c['call_from_number'] ?? '')) ? ($c['call_to_number'] ?? '') : ($c['call_from_number'] ?? '');
    else $other = ($type === 'Inbound') ? ($c['call_from_number'] ?? '') : ($c['call_to_number'] ?? '');
    if ($other !== '') $a['nums'][$other] = true;
    if (count($a['recent']) < 15) {
        $ts = (int)($c['timestamp'] ?? 0);
        $a['recent'][] = [
            't'   => $ts ? date('H:i', $ts) : substr((string)($c['time'] ?? ''), 11, 5),
            'num' => (string)$other,
            'dir' => $type === 'Inbound' ? 'in' : ($type === 'Outbound' ? 'out' : 'int'),
            'disp'=> $disp,
            'dur' => $talk,
        ];
    }
    unset($a);
    }
}

$rows = [];
foreach ($agg as $ext => $a) {
    $rows[] = [
        'extension'=>$ext,'stat_date'=>$today,'total'=>$a['total'],'inbound'=>$a['inbound'],
        'outbound'=>$a['outbound'],'internal'=>$a['internal'],'answered'=>$a['answered'],
        'missed'=>$a['missed'],'missed_inbound'=>$a['missed_inbound'],'talk_seconds'=>$a['talk_seconds'],
        'ring_seconds'=>$a['ring_seconds'],'unique_numbers'=>count($a['nums']),
        'recent'=>array_values($a['recent']),'updated_at'=>date('c'),
    ];
}
if (!$rows) { fwrite(STDERR, date('c')." no extension calls today\n"); exit(0); }

$ch = curl_init($SUP_URL . '/rest/v1/call_stats_daily');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'apikey: ' . $SUP_KEY,
        'Authorization: Bearer ' . $SUP_KEY,
        'Content-Type: application/json',
        'Prefer: resolution=merge-duplicates,return=minimal',
    ],
    CURLOPT_POSTFIELDS => json_encode($rows),
    CURLOPT_TIMEOUT => 30,
]);
$out = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
fwrite(STDERR, date('c')." pushed ".count($rows)." rows, http=$code ".($code>=300?$out:'')."\n");
exit($code >= 300 ? 1 : 0);
