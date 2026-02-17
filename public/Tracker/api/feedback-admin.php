<?php
require_once __DIR__ . '/feedback-common.php';

fb_preflight('GET, POST, OPTIONS');

function fb_parse_date_start(string $date): ?int {
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    return null;
  }
  $ts = strtotime($date . ' 00:00:00 UTC');
  return $ts === false ? null : ((int)$ts * 1000);
}

function fb_parse_date_end(string $date): ?int {
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    return null;
  }
  $ts = strtotime($date . ' 23:59:59 UTC');
  return $ts === false ? null : ((int)$ts * 1000);
}

function fb_filter_entries(array $entries, string $outlet, ?int $startMs, ?int $endMs): array {
  $filtered = [];
  $outletLower = strtolower(trim($outlet));

  foreach ($entries as $entry) {
    if (!is_array($entry)) {
      continue;
    }
    $ts = isset($entry['createdAt']) && is_numeric($entry['createdAt']) ? (int)$entry['createdAt'] : 0;
    if ($startMs !== null && $ts < $startMs) {
      continue;
    }
    if ($endMs !== null && $ts > $endMs) {
      continue;
    }
    if ($outletLower !== '') {
      $name = strtolower(trim((string)($entry['outlet'] ?? '')));
      if ($name !== $outletLower) {
        continue;
      }
    }
    $filtered[] = $entry;
  }

  usort($filtered, function ($a, $b) {
    return (int)($b['createdAt'] ?? 0) <=> (int)($a['createdAt'] ?? 0);
  });

  return $filtered;
}

function fb_compute_analytics(array $entries): array {
  $total = count($entries);
  $sumOverall = 0;
  $positive = 0;
  $detractors = 0;
  $aspects = ['service' => 0, 'quality' => 0, 'cleanliness' => 0, 'speed' => 0, 'value' => 0];
  $aspectCounts = ['service' => 0, 'quality' => 0, 'cleanliness' => 0, 'speed' => 0, 'value' => 0];
  $byOutlet = [];

  foreach ($entries as $entry) {
    $rating = isset($entry['overallRating']) && is_numeric($entry['overallRating']) ? (int)$entry['overallRating'] : 0;
    if ($rating > 0) {
      $sumOverall += $rating;
      if ($rating >= 4) {
        $positive++;
      } else {
        $detractors++;
      }
    }

    $outlet = fb_str($entry['outlet'] ?? 'Unknown Outlet', 120);
    if (!isset($byOutlet[$outlet])) {
      $byOutlet[$outlet] = [
        'outlet' => $outlet,
        'total' => 0,
        'sumOverall' => 0,
        'positive' => 0,
      ];
    }
    $byOutlet[$outlet]['total']++;
    $byOutlet[$outlet]['sumOverall'] += $rating;
    if ($rating >= 4) {
      $byOutlet[$outlet]['positive']++;
    }

    $entryAspects = is_array($entry['aspects'] ?? null) ? $entry['aspects'] : [];
    foreach ($aspects as $k => $_) {
      if (isset($entryAspects[$k]) && is_numeric($entryAspects[$k])) {
        $v = (int)$entryAspects[$k];
        if ($v >= 1 && $v <= 5) {
          $aspects[$k] += $v;
          $aspectCounts[$k]++;
        }
      }
    }
  }

  $outletBreakdown = array_values(array_map(function ($row) {
    $avg = $row['total'] > 0 ? round($row['sumOverall'] / $row['total'], 2) : 0;
    $posRate = $row['total'] > 0 ? round(($row['positive'] / $row['total']) * 100, 1) : 0;
    return [
      'outlet' => $row['outlet'],
      'total' => $row['total'],
      'avgOverall' => $avg,
      'positiveRate' => $posRate,
    ];
  }, $byOutlet));

  usort($outletBreakdown, function ($a, $b) {
    return $b['total'] <=> $a['total'];
  });

  $aspectAverages = [];
  foreach ($aspects as $k => $sum) {
    $aspectAverages[$k] = $aspectCounts[$k] > 0 ? round($sum / $aspectCounts[$k], 2) : 0;
  }

  return [
    'summary' => [
      'totalResponses' => $total,
      'avgOverall' => $total > 0 ? round($sumOverall / $total, 2) : 0,
      'positiveCount' => $positive,
      'detractorCount' => $detractors,
      'positiveRate' => $total > 0 ? round(($positive / $total) * 100, 1) : 0,
      'aspectAverages' => $aspectAverages,
    ],
    'outletBreakdown' => $outletBreakdown,
  ];
}

$action = fb_str($_GET['action'] ?? '', 60);
$body = $_SERVER['REQUEST_METHOD'] === 'POST' ? fb_get_request_json() : [];

if ($action === 'login') {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fb_respond(['success' => false, 'error' => 'Method not allowed'], 405);
  }

  $username = fb_str($body['username'] ?? '', 120);
  $passcode = fb_str($body['passcode'] ?? '', 120);
  if ($username === '' || $passcode === '') {
    fb_respond(['success' => false, 'error' => 'Username and passcode are required'], 400);
  }

  $user = fb_find_superadmin_user($username);
  if ($user === null) {
    fb_respond(['success' => false, 'error' => 'Only superadmin users can access this dashboard'], 403);
  }

  $config = fb_get_admin_config();
  $expectedPasscode = fb_str($config['adminPasscode'] ?? '', 120);
  if ($expectedPasscode === '' || $passcode !== $expectedPasscode) {
    fb_respond(['success' => false, 'error' => 'Invalid passcode'], 401);
  }

  $tokenInfo = fb_issue_admin_token($username);
  $mustChangePasscode = $expectedPasscode === 'change-me-now';

  fb_respond([
    'success' => true,
    'token' => $tokenInfo['token'],
    'expiresAt' => $tokenInfo['expiresAt'],
    'username' => $username,
    'mustChangePasscode' => $mustChangePasscode,
  ]);
}

if ($action === 'public-outlets') {
  fb_respond([
    'success' => true,
    'outlets' => fb_get_outlets(),
  ]);
}

$session = fb_require_admin_session();

if ($action === 'logout') {
  $token = fb_extract_admin_token();
  fb_revoke_admin_token($token);
  fb_respond(['success' => true]);
}

if ($action === 'change-passcode') {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fb_respond(['success' => false, 'error' => 'Method not allowed'], 405);
  }
  $newPasscode = fb_str($body['newPasscode'] ?? '', 120);
  if (strlen($newPasscode) < 6) {
    fb_respond(['success' => false, 'error' => 'Passcode must be at least 6 characters'], 400);
  }
  $config = fb_get_admin_config();
  $config['adminPasscode'] = $newPasscode;
  if (!fb_save_admin_config($config)) {
    fb_respond(['success' => false, 'error' => 'Failed to save passcode'], 500);
  }
  fb_respond(['success' => true]);
}

if ($action === 'save-settings') {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fb_respond(['success' => false, 'error' => 'Method not allowed'], 405);
  }
  $incoming = is_array($body['outletConfigs'] ?? null) ? $body['outletConfigs'] : [];
  $clean = [];
  foreach ($incoming as $outletName => $config) {
    $name = fb_str($outletName, 120);
    if ($name === '' || !is_array($config)) {
      continue;
    }
    $clean[$name] = [
      'googleReviewUrl' => fb_str($config['googleReviewUrl'] ?? '', 600),
      'whatsappNumber' => fb_clean_phone(fb_str($config['whatsappNumber'] ?? '', 40)),
      'phoneNumber' => fb_clean_phone(fb_str($config['phoneNumber'] ?? '', 40)),
      'reviewRedirectEnabled' => fb_bool($config['reviewRedirectEnabled'] ?? true),
    ];
  }
  $settings = fb_get_feedback_settings();
  $settings['outletConfigs'] = $clean;
  $settings['updatedBy'] = fb_str($session['username'] ?? 'unknown', 120);
  if (!fb_save_feedback_settings($settings)) {
    fb_respond(['success' => false, 'error' => 'Failed to save settings'], 500);
  }
  fb_respond(['success' => true, 'settings' => $settings]);
}

if ($action === 'analytics' || $action === 'bootstrap') {
  $startDate = fb_str($_GET['startDate'] ?? '', 20);
  $endDate = fb_str($_GET['endDate'] ?? '', 20);
  $outlet = fb_str($_GET['outlet'] ?? '', 120);
  $page = isset($_GET['page']) && is_numeric($_GET['page']) ? max(1, (int)$_GET['page']) : 1;
  $limit = isset($_GET['limit']) && is_numeric($_GET['limit']) ? max(10, min(200, (int)$_GET['limit'])) : 50;

  if ($action === 'bootstrap' && $startDate === '' && $endDate === '') {
    $endDate = gmdate('Y-m-d');
    $startDate = gmdate('Y-m-d', strtotime('-30 days'));
  }

  $startMs = $startDate !== '' ? fb_parse_date_start($startDate) : null;
  $endMs = $endDate !== '' ? fb_parse_date_end($endDate) : null;

  $allEntries = fb_read_feedback_entries();
  $filtered = fb_filter_entries($allEntries, $outlet, $startMs, $endMs);
  $analytics = fb_compute_analytics($filtered);

  $total = count($filtered);
  $offset = ($page - 1) * $limit;
  $recent = array_slice($filtered, $offset, $limit);

  $settings = fb_get_feedback_settings();
  fb_respond([
    'success' => true,
    'filters' => [
      'startDate' => $startDate,
      'endDate' => $endDate,
      'outlet' => $outlet,
      'page' => $page,
      'limit' => $limit,
    ],
    'summary' => $analytics['summary'],
    'outletBreakdown' => $analytics['outletBreakdown'],
    'recent' => $recent,
    'pagination' => [
      'total' => $total,
      'page' => $page,
      'limit' => $limit,
      'hasMore' => ($offset + $limit) < $total,
    ],
    'settings' => $settings,
    'outlets' => fb_get_outlets(),
    'session' => [
      'username' => fb_str($session['username'] ?? '', 120),
      'role' => fb_str($session['role'] ?? '', 40),
    ],
  ]);
}

fb_respond(['success' => false, 'error' => 'Unsupported action'], 400);
