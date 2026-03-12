<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

function respond($data, $status = 200) {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function normalize_base_url($input) {
  $base = trim((string)$input);
  if ($base === '') {
    $base = 'https://www.onlineebiocloud.com';
  }
  if (!preg_match('#^https?://#i', $base)) {
    $base = 'https://' . $base;
  }
  return rtrim($base, '/');
}

function build_absolute_url($baseUrl, $pathOrUrl) {
  $pathOrUrl = trim((string)$pathOrUrl);
  if ($pathOrUrl === '') return $baseUrl;
  if (preg_match('#^https?://#i', $pathOrUrl)) return $pathOrUrl;
  if (strpos($pathOrUrl, '/') === 0) return $baseUrl . $pathOrUrl;
  return $baseUrl . '/' . $pathOrUrl;
}

function normalize_month_key($monthKey) {
  $monthKey = trim((string)$monthKey);
  if (preg_match('/^\d{4}-\d{2}$/', $monthKey)) return $monthKey;
  return gmdate('Y-m');
}

function month_key_to_date_range($monthKey) {
  $monthKey = normalize_month_key($monthKey);
  list($year, $month) = explode('-', $monthKey);
  $year = intval($year);
  $month = intval($month);
  $startTs = gmmktime(0, 0, 0, $month, 1, $year);
  $endTs = gmmktime(0, 0, 0, $month + 1, 0, $year);
  return [
    'fromDate' => gmdate('d/m/Y', $startTs),
    'toDate' => gmdate('d/m/Y', $endTs),
    'reportStartDate' => gmdate('Y-m-d', $startTs),
    'reportEndDate' => gmdate('Y-m-d', $endTs),
  ];
}

function parse_dmy_to_iso($value) {
  $value = trim((string)$value);
  if ($value === '') return null;
  if (preg_match('/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/', $value, $m)) {
    $dd = intval($m[1]);
    $mm = intval($m[2]);
    $yy = intval($m[3]);
    return sprintf('%04d-%02d-%02d', $yy, $mm, $dd);
  }
  if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value)) return $value;
  return null;
}

function extract_input_value($html, $name) {
  if (!is_string($html) || $html === '') return '';
  if (preg_match('/name="' . preg_quote($name, '/') . '"[^>]*value="([^"]*)"/i', $html, $matches)) {
    return html_entity_decode($matches[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
  }
  return '';
}

function extract_hidden_inputs($html) {
  $map = [];
  if (!is_string($html) || $html === '') return $map;
  if (!preg_match_all('/<input[^>]*type="hidden"[^>]*>/i', $html, $inputTags)) {
    return $map;
  }
  foreach ($inputTags[0] as $tag) {
    if (!preg_match('/name="([^"]+)"/i', $tag, $nameMatch)) continue;
    $name = $nameMatch[1];
    $value = '';
    if (preg_match('/value="([^"]*)"/i', $tag, $valueMatch)) {
      $value = html_entity_decode($valueMatch[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    $map[$name] = $value;
  }
  return $map;
}

function looks_like_login_page($html) {
  if (!is_string($html) || $html === '') return false;
  if (stripos($html, 'id="LoginForm"') !== false) return true;
  if (stripos($html, 'name="TextBox1"') !== false && stripos($html, 'name="TextBox2"') !== false && stripos($html, 'name="TextBox3"') !== false) return true;
  return false;
}

function contains_viewstate_mac_error($html) {
  if (!is_string($html) || $html === '') return false;
  return stripos($html, 'Validation of viewstate MAC failed') !== false;
}

function normalize_header_key($value) {
  $value = strtolower(trim((string)$value));
  return preg_replace('/[^a-z0-9]+/', '', $value);
}

function parse_number($value) {
  $value = trim((string)$value);
  if ($value === '') return 0;
  $normalized = str_replace(',', '', $value);
  if (!is_numeric($normalized)) return 0;
  return floatval($normalized);
}

function parse_minutes($value) {
  $raw = trim((string)$value);
  if ($raw === '') return 0;
  $raw = preg_replace('/\s+/', '', $raw);

  if (preg_match('/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/', $raw, $m)) {
    $hh = intval($m[1]);
    $mm = intval($m[2]);
    $ss = isset($m[3]) ? intval($m[3]) : 0;
    return max(0, ($hh * 60) + $mm + (int)round($ss / 60));
  }

  $normalized = str_replace(',', '.', $raw);
  if (is_numeric($normalized)) {
    $hours = floatval($normalized);
    return max(0, (int)round($hours * 60));
  }
  return 0;
}

function minutes_to_text($minutes) {
  $minutes = max(0, intval($minutes));
  $hh = floor($minutes / 60);
  $mm = $minutes % 60;
  return sprintf('%02d:%02d', $hh, $mm);
}

function resolve_col_index($headerMap, $aliases) {
  foreach ($aliases as $alias) {
    $key = normalize_header_key($alias);
    if (isset($headerMap[$key])) return $headerMap[$key];
  }
  return -1;
}

function extract_tables_as_rows($html) {
  $allTables = [];
  if (!is_string($html) || trim($html) === '') return $allTables;
  if (!class_exists('DOMDocument')) return $allTables;

  libxml_use_internal_errors(true);
  $doc = new DOMDocument();
  $loaded = $doc->loadHTML($html);
  if (!$loaded) return $allTables;

  $xpath = new DOMXPath($doc);
  $tables = $xpath->query('//table');
  if (!$tables) return $allTables;

  foreach ($tables as $table) {
    $rows = [];
    $trNodes = $xpath->query('.//tr', $table);
    if (!$trNodes) continue;
    foreach ($trNodes as $tr) {
      $cells = [];
      $cellNodes = $xpath->query('./th|./td', $tr);
      if (!$cellNodes) continue;
      foreach ($cellNodes as $cell) {
        $text = html_entity_decode(trim(preg_replace('/\s+/', ' ', $cell->textContent)), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $cells[] = $text;
      }
      if (!empty($cells)) $rows[] = $cells;
    }
    if (!empty($rows)) $allTables[] = $rows;
  }

  return $allTables;
}

function parse_attendance_rows_from_report_html($html, $sourceSheetName = 'NewMonthly.aspx') {
  $tables = extract_tables_as_rows($html);
  if (empty($tables)) {
    return [];
  }

  foreach ($tables as $rows) {
    $bestHeaderIndex = -1;
    $headerMap = [];

    for ($i = 0; $i < count($rows); $i++) {
      $row = $rows[$i];
      $currentMap = [];
      foreach ($row as $idx => $cell) {
        $key = normalize_header_key($cell);
        if ($key !== '') $currentMap[$key] = $idx;
      }
      $empCodeIdx = resolve_col_index($currentMap, ['EmpCode', 'Employee Code', 'Emp Code']);
      $nameIdx = resolve_col_index($currentMap, ['Name', 'Employee Name']);
      $presentIdx = resolve_col_index($currentMap, ['Present', 'Present Days', 'PresentDays']);
      if ($empCodeIdx >= 0 && $nameIdx >= 0 && $presentIdx >= 0) {
        $bestHeaderIndex = $i;
        $headerMap = $currentMap;
        break;
      }
    }

    if ($bestHeaderIndex < 0) {
      continue;
    }

    $empCodeIdx = resolve_col_index($headerMap, ['EmpCode', 'Employee Code', 'Emp Code']);
    $nameIdx = resolve_col_index($headerMap, ['Name', 'Employee Name']);
    $presentIdx = resolve_col_index($headerMap, ['Present', 'Present Days', 'PresentDays']);
    $halfLeaveIdx = resolve_col_index($headerMap, ['HL', 'Half Leave', 'HalfLeave']);
    $weeklyOffIdx = resolve_col_index($headerMap, ['WO', 'Week Off', 'Weekly Off', 'WeeklyOff']);
    $absentIdx = resolve_col_index($headerMap, ['Absent', 'Absent Days', 'AbsentDays']);
    $leaveIdx = resolve_col_index($headerMap, ['Leave', 'Leave Days', 'LeaveDays']);
    $paidDaysIdx = resolve_col_index($headerMap, ['PaidDays', 'Paid Days']);
    $lateIdx = resolve_col_index($headerMap, ['LateHrs', 'Late Hrs', 'LateHours', 'Late']);
    $workIdx = resolve_col_index($headerMap, ['WorkHrs', 'Work Hrs', 'WorkHours']);
    $otIdx = resolve_col_index($headerMap, ['OvTim', 'O.Times Hrs.', 'OT', 'Overtime', 'Over Time']);

    $parsed = [];
    for ($r = $bestHeaderIndex + 1; $r < count($rows); $r++) {
      $row = $rows[$r];
      $code = $empCodeIdx >= 0 ? trim((string)($row[$empCodeIdx] ?? '')) : '';
      $name = $nameIdx >= 0 ? trim((string)($row[$nameIdx] ?? '')) : '';
      if ($code === '' || $name === '') continue;

      $codeKey = strtolower($code);
      if (strpos($codeKey, 'total') !== false || strpos($codeKey, 'grand') !== false) continue;

      $lateText = $lateIdx >= 0 ? trim((string)($row[$lateIdx] ?? '')) : '';
      $workText = $workIdx >= 0 ? trim((string)($row[$workIdx] ?? '')) : '';
      $otText = $otIdx >= 0 ? trim((string)($row[$otIdx] ?? '')) : '';
      $lateMinutes = parse_minutes($lateText);
      $workMinutes = parse_minutes($workText);
      $overtimeMinutes = parse_minutes($otText);

      $parsed[] = [
        'employeeCode' => $code,
        'employeeName' => $name,
        'presentDays' => parse_number($presentIdx >= 0 ? ($row[$presentIdx] ?? '') : 0),
        'halfLeaveDays' => parse_number($halfLeaveIdx >= 0 ? ($row[$halfLeaveIdx] ?? '') : 0),
        'weeklyOffDays' => parse_number($weeklyOffIdx >= 0 ? ($row[$weeklyOffIdx] ?? '') : 0),
        'absentDays' => parse_number($absentIdx >= 0 ? ($row[$absentIdx] ?? '') : 0),
        'leaveDays' => parse_number($leaveIdx >= 0 ? ($row[$leaveIdx] ?? '') : 0),
        'paidDays' => parse_number($paidDaysIdx >= 0 ? ($row[$paidDaysIdx] ?? '') : 0),
        'lateHoursText' => $lateText !== '' ? $lateText : ($lateMinutes > 0 ? minutes_to_text($lateMinutes) : ''),
        'lateMinutes' => $lateMinutes,
        'workHoursText' => $workText !== '' ? $workText : ($workMinutes > 0 ? minutes_to_text($workMinutes) : ''),
        'workMinutes' => $workMinutes,
        'overtimeText' => $otText !== '' ? $otText : ($overtimeMinutes > 0 ? minutes_to_text($overtimeMinutes) : ''),
        'overtimeMinutes' => $overtimeMinutes,
        'holidaysText' => '',
        'holidaysMinutes' => 0,
        'holidayMercText' => '',
        'holidayMercMinutes' => 0,
        'holidayPublicText' => '',
        'holidayPublicMinutes' => 0,
        'sourceSheet' => $sourceSheetName,
      ];
    }

    if (!empty($parsed)) {
      return $parsed;
    }
  }

  return [];
}

function score_export_body_quality($body, $contentType = '') {
  $text = strtolower((string)$body);
  if ($text === '') return -1000;
  if (strpos($text, 'validation of viewstate mac failed') !== false) return -1000;
  if (strpos($text, 'id="loginform"') !== false) return -900;
  if (strpos($text, 'loading...cancel') !== false) return -800;

  $score = 0;
  $contentType = strtolower(trim((string)$contentType));
  if (strpos($contentType, 'application/vnd.ms-excel') !== false || strpos($contentType, 'application/octet-stream') !== false) {
    $score += 40;
  }
  if (strpos($text, 'poh') !== false) $score += 80;
  if (strpos($text, 'status') !== false) $score += 40;
  if (strpos($text, 'o.times hrs') !== false || strpos($text, 'otimes hrs') !== false) $score += 40;
  if (strpos($text, 'monthly summary report') !== false) $score += 10;
  $score += min(30, intval(strlen($text) / 15000));
  return $score;
}

function pull_report_once($payload) {
  $portalBaseUrl = normalize_base_url($payload['portalBaseUrl'] ?? 'https://www.onlineebiocloud.com');
  $monthlyReportPath = trim((string)($payload['monthlyReportPath'] ?? 'NewMonthly.aspx'));
  if ($monthlyReportPath === '') $monthlyReportPath = 'NewMonthly.aspx';
  $monthKey = normalize_month_key($payload['monthKey'] ?? '');
  $defaultRange = month_key_to_date_range($monthKey);
  $fromDate = trim((string)($payload['fromDate'] ?? '')) ?: $defaultRange['fromDate'];
  $toDate = trim((string)($payload['toDate'] ?? '')) ?: $defaultRange['toDate'];

  $username = trim((string)($payload['userName'] ?? ''));
  $password = trim((string)($payload['password'] ?? ''));
  $corporateId = trim((string)($payload['corporateId'] ?? ''));
  if ($username === '' || $password === '' || $corporateId === '') {
    throw new Exception('Corporate ID, User Name, and Password are required.');
  }

  $host = parse_url($portalBaseUrl, PHP_URL_HOST);
  $resolve = null;
  if ($host) {
    $ips = @gethostbynamel($host);
    if (is_array($ips) && count($ips) > 0) {
      $resolve = [$host . ':443:' . $ips[0]];
    }
  }

  $cookieFile = tempnam(sys_get_temp_dir(), 'hr_fingerprint_cookie_');
  if (!$cookieFile) throw new Exception('Unable to create temporary session store.');

  $ch = curl_init();
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 10,
    CURLOPT_CONNECTTIMEOUT => 20,
    CURLOPT_TIMEOUT => 90,
    CURLOPT_COOKIEJAR => $cookieFile,
    CURLOPT_COOKIEFILE => $cookieFile,
    CURLOPT_USERAGENT => 'TrackerHRFingerprintPull/1.0',
    CURLOPT_ENCODING => '',
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_HTTPHEADER => ['Expect:'],
  ]);
  if ($resolve) {
    curl_setopt($ch, CURLOPT_RESOLVE, $resolve);
  }

  $request = function($url, $postFields = null) use ($ch) {
    curl_setopt($ch, CURLOPT_URL, $url);
    if ($postFields !== null) {
      curl_setopt($ch, CURLOPT_POST, true);
      curl_setopt($ch, CURLOPT_POSTFIELDS, $postFields);
    } else {
      curl_setopt($ch, CURLOPT_POST, false);
      curl_setopt($ch, CURLOPT_HTTPGET, true);
      curl_setopt($ch, CURLOPT_POSTFIELDS, null);
    }
    $body = curl_exec($ch);
    $error = curl_error($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    if ($body === false) {
      throw new Exception('Connection error: ' . ($error ?: 'Unknown cURL error'));
    }
    return [
      'body' => $body,
      'httpCode' => $httpCode,
      'contentType' => $contentType,
      'effectiveUrl' => (string)curl_getinfo($ch, CURLINFO_EFFECTIVE_URL),
    ];
  };

  try {
    $loginUrl = build_absolute_url($portalBaseUrl, '/Default.aspx');
    $loginPage = $request($loginUrl);
    $hiddenLogin = extract_hidden_inputs($loginPage['body']);

    $loginPost = [
      '__VIEWSTATE' => $hiddenLogin['__VIEWSTATE'] ?? '',
      '__VIEWSTATEGENERATOR' => $hiddenLogin['__VIEWSTATEGENERATOR'] ?? '',
      '__EVENTVALIDATION' => $hiddenLogin['__EVENTVALIDATION'] ?? '',
      'TextBox1' => $corporateId,
      'TextBox2' => $username,
      'TextBox3' => $password,
      'Button1' => 'Log in',
      'ClientDate' => gmdate('Y-m-d'),
      'ClientDate1' => gmdate('Y-m-d'),
    ];
    $loginResponse = $request($loginUrl, http_build_query($loginPost, '', '&', PHP_QUERY_RFC3986));
    if (looks_like_login_page($loginResponse['body'])) {
      throw new Exception('Invalid fingerprint portal credentials.');
    }

    $monthlyUrl = build_absolute_url($portalBaseUrl, $monthlyReportPath);
    $monthlyPage = $request($monthlyUrl);
    if (looks_like_login_page($monthlyPage['body'])) {
      throw new Exception('Session expired while opening monthly report page.');
    }
    $hiddenMonthly = extract_hidden_inputs($monthlyPage['body']);
    if (empty($hiddenMonthly['__VIEWSTATE'])) {
      throw new Exception('Monthly report page did not expose required form state.');
    }

    $showReportPost = [
      '__EVENTTARGET' => '',
      '__EVENTARGUMENT' => '',
      '__VIEWSTATE' => $hiddenMonthly['__VIEWSTATE'] ?? '',
      '__VIEWSTATEGENERATOR' => $hiddenMonthly['__VIEWSTATEGENERATOR'] ?? '',
      '__EVENTVALIDATION' => $hiddenMonthly['__EVENTVALIDATION'] ?? '',
      '__PREVIOUSPAGE' => $hiddenMonthly['__PREVIOUSPAGE'] ?? '',
      'ctl00$Hidden1' => $hiddenMonthly['ctl00$Hidden1'] ?? '',
      'ctl00$MainContent$txtdate' => $fromDate,
      'ctl00$MainContent$txttodate' => $toDate,
      'ctl00$MainContent$Cmpny' => 'SelectAllCommany',
      'ctl00$MainContent$shift1' => 'Allshift',
      'ctl00$MainContent$Dept' => 'AllDesignation',
      'ctl00$MainContent$Desig' => 'RadioButton1',
      'ctl00$MainContent$Emp' => 'optAllEmployee',
      'ctl00$MainContent$Daily' => 'optmonthlyperformence',
      'ctl00$MainContent$cmdShowReport' => 'ShowReport',
    ];

    $reportResponse = $request($monthlyUrl, http_build_query($showReportPost, '', '&', PHP_QUERY_RFC3986));
    $reportHtml = $reportResponse['body'];
    $rawReportBody = $reportHtml;
    $rawReportContentType = $reportResponse['contentType'];

    if (contains_viewstate_mac_error($reportHtml)) {
      throw new Exception('Monthly report postback failed due server ViewState MAC validation.');
    }
    if (looks_like_login_page($reportHtml)) {
      throw new Exception('Session expired while loading monthly report.');
    }

    $rows = parse_attendance_rows_from_report_html($reportHtml, basename(parse_url($monthlyUrl, PHP_URL_PATH) ?: 'NewMonthly.aspx'));
    $selectedExport = 'showreport-html';
    $exportCandidatesTried = [];
    if (empty($rows)) {
      $monthlyPage2 = $request($monthlyUrl);
      $hiddenMonthly2 = extract_hidden_inputs($monthlyPage2['body']);
      $commonPost = [
        '__EVENTTARGET' => '',
        '__EVENTARGUMENT' => '',
        '__VIEWSTATE' => $hiddenMonthly2['__VIEWSTATE'] ?? '',
        '__VIEWSTATEGENERATOR' => $hiddenMonthly2['__VIEWSTATEGENERATOR'] ?? '',
        '__EVENTVALIDATION' => $hiddenMonthly2['__EVENTVALIDATION'] ?? '',
        '__PREVIOUSPAGE' => $hiddenMonthly2['__PREVIOUSPAGE'] ?? '',
        'ctl00$Hidden1' => $hiddenMonthly2['ctl00$Hidden1'] ?? '',
        'ctl00$MainContent$txtdate' => $fromDate,
        'ctl00$MainContent$txttodate' => $toDate,
        'ctl00$MainContent$Cmpny' => 'SelectAllCommany',
        'ctl00$MainContent$shift1' => 'Allshift',
        'ctl00$MainContent$Dept' => 'AllDesignation',
        'ctl00$MainContent$Desig' => 'RadioButton1',
        'ctl00$MainContent$Emp' => 'optAllEmployee',
      ];

      $exportCandidates = [
        [
          'label' => 'vertical-performance',
          'daily' => 'optmonthlyperformence',
          'buttonName' => 'ctl00$MainContent$Button1',
          'buttonValue' => 'Vertical Performance',
        ],
        [
          'label' => 'attendance',
          'daily' => 'optmonthlyattendence',
          'buttonName' => 'ctl00$MainContent$Button2',
          'buttonValue' => 'Attendance',
        ],
        [
          'label' => 'monthly-summary',
          'daily' => 'MonthlySummaryDetails',
          'buttonName' => 'ctl00$MainContent$Button10',
          'buttonValue' => 'Monthly Summary In Excel',
        ],
      ];

      $best = null;
      foreach ($exportCandidates as $candidate) {
        $post = $commonPost;
        $post['ctl00$MainContent$Daily'] = $candidate['daily'];
        $post[$candidate['buttonName']] = $candidate['buttonValue'];
        $candidateResponse = $request($monthlyUrl, http_build_query($post, '', '&', PHP_QUERY_RFC3986));
        $candidateBody = $candidateResponse['body'];
        if (contains_viewstate_mac_error($candidateBody) || looks_like_login_page($candidateBody)) {
          $exportCandidatesTried[] = [
            'label' => $candidate['label'],
            'score' => -1000,
            'rows' => 0,
            'size' => strlen((string)$candidateBody),
          ];
          continue;
        }

        $candidateRows = parse_attendance_rows_from_report_html($candidateBody, basename(parse_url($monthlyUrl, PHP_URL_PATH) ?: 'NewMonthly.aspx'));
        $contentTypeLower = strtolower(trim((string)$candidateResponse['contentType']));
        $isExcelLike = strpos($contentTypeLower, 'application/vnd.ms-excel') !== false || strpos($contentTypeLower, 'application/octet-stream') !== false;
        $candidateScore = ($isExcelLike ? 1000 : 0) + score_export_body_quality($candidateBody, $candidateResponse['contentType']) + (count($candidateRows) > 0 ? 25 : 0);
        $exportCandidatesTried[] = [
          'label' => $candidate['label'],
          'score' => $candidateScore,
          'rows' => count($candidateRows),
          'size' => strlen((string)$candidateBody),
        ];

        if ($best === null || $candidateScore > $best['score']) {
          $best = [
            'label' => $candidate['label'],
            'score' => $candidateScore,
            'rows' => $candidateRows,
            'body' => $candidateBody,
            'contentType' => $candidateResponse['contentType'],
          ];
        }
      }

      if ($best !== null) {
        $selectedExport = $best['label'];
        $rows = $best['rows'];
        $rawReportBody = $best['body'];
        $rawReportContentType = $best['contentType'];
      }
    }

    if (empty($rows) && trim((string)$rawReportBody) === '') {
      throw new Exception('No valid attendance rows found in portal report output.');
    }

    $monthLabel = gmdate('M-Y', strtotime($monthKey . '-01'));
    if (preg_match('/Attendnace Month Of:-\s*([^<\r\n]+)/i', $reportHtml, $monthMatch) || preg_match('/Attendance Month Of:-\s*([^<\r\n]+)/i', $reportHtml, $monthMatch)) {
      $monthLabel = trim($monthMatch[1]);
    }

    return [
      'rows' => $rows,
      'monthKey' => $monthKey,
      'monthLabel' => $monthLabel,
      'reportStartDate' => parse_dmy_to_iso($fromDate) ?: $defaultRange['reportStartDate'],
      'reportEndDate' => parse_dmy_to_iso($toDate) ?: $defaultRange['reportEndDate'],
      'sourceSheetName' => basename(parse_url($monthlyUrl, PHP_URL_PATH) ?: 'NewMonthly.aspx'),
      'diagnostics' => [
        'monthlyUrl' => $monthlyUrl,
        'fromDate' => $fromDate,
        'toDate' => $toDate,
        'selectedExport' => $selectedExport,
        'exportCandidates' => $exportCandidatesTried,
      ],
      'reportBase64' => base64_encode((string)$rawReportBody),
      'reportContentType' => $rawReportContentType,
    ];
  } finally {
    curl_close($ch);
    @unlink($cookieFile);
  }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  respond(['error' => 'Method not allowed'], 405);
}

$input = file_get_contents('php://input');
$payload = json_decode($input, true);
if (!is_array($payload)) {
  respond(['error' => 'Invalid JSON body'], 400);
}

$lastError = null;
for ($attempt = 1; $attempt <= 3; $attempt++) {
  try {
    $result = pull_report_once($payload);
    respond([
      'success' => true,
      'monthKey' => $result['monthKey'],
      'monthLabel' => $result['monthLabel'],
      'reportStartDate' => $result['reportStartDate'],
      'reportEndDate' => $result['reportEndDate'],
      'sourceSheetName' => $result['sourceSheetName'],
      'rows' => $result['rows'],
      'reportBase64' => $result['reportBase64'] ?? null,
      'reportContentType' => $result['reportContentType'] ?? null,
      'diagnostics' => [
        'attempt' => $attempt,
        'monthlyUrl' => $result['diagnostics']['monthlyUrl'] ?? null,
        'selectedExport' => $result['diagnostics']['selectedExport'] ?? null,
        'exportCandidates' => $result['diagnostics']['exportCandidates'] ?? [],
      ],
    ]);
  } catch (Exception $e) {
    $lastError = $e->getMessage();
  }
}

respond([
  'success' => false,
  'error' => $lastError ?: 'Failed to pull monthly report',
], 502);
